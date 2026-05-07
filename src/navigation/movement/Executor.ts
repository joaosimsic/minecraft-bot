import type { AsyncResult, Result } from '../../shared/result';
import { fail, ok, wrap } from '../../shared/result';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { NavigationAction } from './Actions';
import type { World } from '../world/World';
import { NavigationValidator } from './Validator';
import { NavigationRecorder } from '../telemetry/Recorder';
import { NAV_EVENT } from '../telemetry/Events';
import type { MovementPhase } from '../telemetry/Events';
import { Node, parseNodeKey } from '../planner/Node';

export type DrainOutcome =
  | { done: true }
  | {
      done: false;
      action: NavigationAction;
      reason: string;
      phase: MovementPhase;
    };

const MAX_WALK_TICKS = 56;
const MAX_JUMP_TICKS = 45;
const MAX_DROP_TICKS = 55;
const MAX_INTERACT_TICKS = 48;

export class NavigationExecutor {
  private queue: NavigationAction[] = [];
  private working: NavigationAction | null = null;
  private bound = false;
  private stepping = false;
  private actionTicks = 0;
  private walkPrimed = false;
  private interactPhase: 'align' | 'activate' | 'wait' = 'align';
  private resolveDrain: ((r: Result<DrainOutcome>) => void) | null = null;
  private tickSource: (() => number) | null = null;

  public constructor(
    private readonly bot: Bot,
    private readonly world: World,
    private readonly validator: NavigationValidator,
    private readonly recorder: NavigationRecorder,
  ) {}

  public setTickSource(fn: () => number): void {
    this.tickSource = fn;
  }

  private gameTick(): number {
    if (this.tickSource !== null) return this.tickSource();
    return this.bot.time.age;
  }

  public drainQueue(initial: NavigationAction[]): AsyncResult<DrainOutcome> {
    if (this.resolveDrain !== null)
      return Promise.resolve(fail(new Error('executor_busy')));
    this.queue = initial.slice();
    this.working = null;
    this.actionTicks = 0;
    this.walkPrimed = false;

    return new Promise<Result<DrainOutcome>>((resolve) => {
      this.resolveDrain = resolve;
      this.attachPhysics();
      void this.callStep();
    });
  }

  private attachPhysics(): void {
    if (this.bound) return;
    this.bound = true;
    this.bot.on('physicsTick', this.onPhysics);
  }

  private detachPhysics(): void {
    if (!this.bound) return;
    this.bound = false;
    this.bot.removeListener('physicsTick', this.onPhysics);
  }

  private readonly onPhysics = (): void => {
    void this.callStep();
  };

  private async callStep(): AsyncResult<void> {
    if (this.stepping) return wrap(Promise.resolve());
    if (this.resolveDrain === null) return wrap(Promise.resolve());

    this.stepping = true;
    const [err] = await wrap(this.stepOnce());
    this.stepping = false;

    if (err) {
      this.releaseControls();
      this.detachPhysics();
      const res = this.resolveDrain;
      this.resolveDrain = null;
      res?.(fail(err));
    }
    return ok(null);
  }

  private finish(out: Result<DrainOutcome>): void {
    this.releaseControls();
    this.detachPhysics();
    const res = this.resolveDrain;
    this.resolveDrain = null;
    res?.(out);
  }

  private releaseControls(): void {
    this.bot.setControlState('forward', false);
    this.bot.setControlState('jump', false);
    this.bot.setControlState('back', false);
    this.bot.setControlState('left', false);
    this.bot.setControlState('right', false);
  }

  private async stepOnce(): Promise<void> {
    if (this.resolveDrain === null) return;

    if (this.working === null) {
      if (this.queue.length === 0) {
        this.finish(ok({ done: true }));
        return;
      }
      const next = this.queue[0];
      if (next === undefined) {
        this.finish(fail(new Error('queue_empty')));
        return;
      }
      const tick = this.gameTick();
      const pre = this.validator.preAction(this.world, this.bot, next, tick);
      if (pre[0] !== null) {
        this.finish(
          ok({
            done: false,
            action: next,
            reason: pre[0].message,
            phase: 'pre_action',
          }),
        );
        return;
      }
      this.queue.shift();
      this.working = next;
      this.actionTicks = 0;
      this.walkPrimed = false;
      this.interactPhase = 'align';
      this.recorder.emit(NAV_EVENT.MOVEMENT_START, {
        action: next.toTelemetry(),
        tick,
      });
      return;
    }

    const cur = this.working;
    if (cur === null) return;

    this.actionTicks += 1;
    const tick = this.gameTick();
    this.recorder.emit(NAV_EVENT.MOVEMENT_TICK, {
      phase: 'macro_step',
      pos: {
        x: +this.bot.entity.position.x.toFixed(3),
        y: +this.bot.entity.position.y.toFixed(3),
        z: +this.bot.entity.position.z.toFixed(3),
      },
      tick,
    });

    if (cur.kind === 'walk') await this.stepWalk(cur);
    if (cur.kind === 'jump_up') await this.stepJump(cur);
    if (cur.kind === 'drop_down') await this.stepDrop(cur);
    if (cur.kind === 'interact') await this.stepInteract(cur);
  }

  private async stepWalk(
    cur: NavigationAction & { kind: 'walk' },
  ): Promise<void> {
    const toOp = parseNodeKey(cur.to);
    if (toOp[0] !== null) {
      this.finish(fail(toOp[0]));
      return;
    }
    const toNode = toOp[1];
    if (toNode === null) {
      this.finish(fail(new Error('walk_to')));
      return;
    }

    if (!this.walkPrimed) {
      this.walkPrimed = true;
      const cx = toNode.x + 0.5;
      const cz = toNode.z + 0.5;
      const eye = this.bot.entity.position.y + 1.6;
      const [e] = await wrap(this.bot.lookAt(new Vec3(cx, eye, cz)));
      if (e) {
        this.finish(
          ok({ done: false, action: cur, reason: e.message, phase: 'macro' }),
        );
        return;
      }
      this.bot.setControlState('forward', true);
      return;
    }

    const post = this.validator.postAction(
      this.world,
      this.bot,
      cur,
      this.gameTick(),
    );
    if (post[0] === null) {
      this.recorder.emit(NAV_EVENT.MOVEMENT_COMPLETE, {
        action: cur.toTelemetry(),
        pos: {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        },
      });
      this.working = null;
      this.bot.setControlState('forward', false);
      if (this.queue.length === 0) this.finish(ok({ done: true }));
      return;
    }

    if (this.actionTicks >= MAX_WALK_TICKS) {
      this.finish(
        ok({
          done: false,
          action: cur,
          reason: post[0].message,
          phase: 'post_action',
        }),
      );
    }
  }

  private async stepJump(
    cur: NavigationAction & { kind: 'jump_up' },
  ): Promise<void> {
    if (this.actionTicks === 1) {
      const toOp = parseNodeKey(cur.to);
      if (toOp[0] !== null) {
        this.finish(fail(toOp[0]));
        return;
      }
      const toNode = toOp[1];
      if (toNode === null) {
        this.finish(fail(new Error('jump_to')));
        return;
      }
      const cx = toNode.x + 0.5;
      const cz = toNode.z + 0.5;
      const eye = this.bot.entity.position.y + 1.6;
      const [e] = await wrap(this.bot.lookAt(new Vec3(cx, eye, cz)));
      if (e) {
        this.finish(
          ok({ done: false, action: cur, reason: e.message, phase: 'macro' }),
        );
        return;
      }
    }

    this.bot.setControlState('forward', true);
    this.bot.setControlState('jump', true);

    const post = this.validator.postAction(
      this.world,
      this.bot,
      cur,
      this.gameTick(),
    );
    if (post[0] === null) {
      this.recorder.emit(NAV_EVENT.MOVEMENT_COMPLETE, {
        action: cur.toTelemetry(),
        pos: {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        },
      });
      this.working = null;
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', false);
      if (this.queue.length === 0) this.finish(ok({ done: true }));
      return;
    }

    if (this.actionTicks >= MAX_JUMP_TICKS) {
      this.finish(
        ok({
          done: false,
          action: cur,
          reason: post[0].message,
          phase: 'post_action',
        }),
      );
    }
  }

  private async stepDrop(
    cur: NavigationAction & { kind: 'drop_down' },
  ): Promise<void> {
    if (this.actionTicks === 1) {
      const toOp = parseNodeKey(cur.to);
      if (toOp[0] !== null) {
        this.finish(fail(toOp[0]));
        return;
      }
      const toNode = toOp[1];
      if (toNode === null) {
        this.finish(fail(new Error('drop_to')));
        return;
      }
      const cx = toNode.x + 0.5;
      const cz = toNode.z + 0.5;
      const eye = this.bot.entity.position.y + 1.6;
      const [e] = await wrap(this.bot.lookAt(new Vec3(cx, eye, cz)));
      if (e) {
        this.finish(
          ok({ done: false, action: cur, reason: e.message, phase: 'macro' }),
        );
        return;
      }
    }

    this.bot.setControlState('forward', true);

    const post = this.validator.postAction(
      this.world,
      this.bot,
      cur,
      this.gameTick(),
    );
    if (post[0] === null) {
      this.recorder.emit(NAV_EVENT.MOVEMENT_COMPLETE, {
        action: cur.toTelemetry(),
        pos: {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        },
      });
      this.working = null;
      this.bot.setControlState('forward', false);
      if (this.queue.length === 0) this.finish(ok({ done: true }));
      return;
    }

    if (this.actionTicks >= MAX_DROP_TICKS) {
      this.finish(
        ok({
          done: false,
          action: cur,
          reason: post[0].message,
          phase: 'post_action',
        }),
      );
    }
  }

  private async stepInteract(
    cur: NavigationAction & { kind: 'interact' },
  ): Promise<void> {
    const tick = this.gameTick();

    if (this.interactPhase === 'align') {
      const [e] = await wrap(
        this.bot.lookAt(
          new Vec3(
            cur.targetX + 0.5,
            this.bot.entity.position.y + 1.6,
            cur.targetZ + 0.5,
          ),
        ),
      );
      if (e) {
        this.finish(
          ok({ done: false, action: cur, reason: e.message, phase: 'macro' }),
        );
        return;
      }
      this.interactPhase = 'activate';
      return;
    }

    if (this.interactPhase === 'activate') {
      const b = this.bot.blockAt(
        new Vec3(cur.targetX, cur.targetY, cur.targetZ),
      );
      if (b === null) {
        this.finish(
          ok({
            done: false,
            action: cur,
            reason: 'interact_no_block',
            phase: 'macro',
          }),
        );
        return;
      }
      const [e] = await wrap(this.bot.activateBlock(b));
      if (e) {
        this.finish(
          ok({ done: false, action: cur, reason: e.message, phase: 'macro' }),
        );
        return;
      }
      this.interactPhase = 'wait';
      return;
    }

    const post = this.validator.postAction(this.world, this.bot, cur, tick);
    if (post[0] === null) {
      this.recorder.emit(NAV_EVENT.MOVEMENT_COMPLETE, {
        action: cur.toTelemetry(),
        pos: {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        },
      });
      this.working = null;
      if (this.queue.length === 0) this.finish(ok({ done: true }));
      return;
    }

    if (this.actionTicks >= MAX_INTERACT_TICKS) {
      this.finish(
        ok({
          done: false,
          action: cur,
          reason: post[0].message,
          phase: 'post_action',
        }),
      );
    }
  }
}
