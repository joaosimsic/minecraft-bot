import type { Bot } from 'mineflayer';
import type { AsyncResult } from '../shared/result';
import { fail, ok } from '../shared/result';
import { AStar } from './planner/AStar';
import { EdgeMemory } from './recovery/EdgeMemory';
import { Recovery } from './recovery/Recovery';
import { NavigationRecorder } from './telemetry/Recorder';
import { NavigationExecutor } from './movement/Executor';
import { NavigationValidator } from './movement/Validator';
import { BotWorld } from './world/BotWorld';
import { Collision } from './world/Collision';
import type { Vec3 } from 'vec3';
import { config } from '../config';

const REPLAN_BUDGET = 14;
const STUCK_TICKS = 36;

export class NavigationController {
  private readonly world: BotWorld;
  private readonly validator: NavigationValidator;
  private readonly edgeMemory: EdgeMemory;
  private readonly recorder: NavigationRecorder;
  private readonly recovery: Recovery;
  private readonly executor: NavigationExecutor;
  private runSeq = 0;
  private draining = false;
  private lastProgressKey = '';
  private stuckTicks = 0;

  public constructor(
    private readonly bot: Bot,
    scope = 'navigation',
  ) {
    this.validator = new NavigationValidator({
      diagonal: config.env.NAV_DIAGONAL,
    });
    const persistPath = config.env.NAV_EDGE_MEMORY_FILE;
    this.edgeMemory = new EdgeMemory(
      persistPath === undefined || persistPath === ''
        ? {
            maxEntries: config.env.NAV_EDGE_MEMORY_MAX_ENTRIES,
            saveEveryFailures: config.env.NAV_EDGE_MEMORY_SAVE_EVERY_FAILURES,
          }
        : {
            persistPath,
            maxEntries: config.env.NAV_EDGE_MEMORY_MAX_ENTRIES,
            saveEveryFailures: config.env.NAV_EDGE_MEMORY_SAVE_EVERY_FAILURES,
          },
    );
    process.once('beforeExit', (): void => {
      void this.edgeMemory.persistSyncQuiet();
    });
    this.world = new BotWorld(bot);
    this.recorder = new NavigationRecorder(scope);
    this.recovery = new Recovery(REPLAN_BUDGET, this.edgeMemory, this.recorder);
    this.executor = new NavigationExecutor(
      bot,
      this.world,
      this.validator,
      this.recorder,
    );
    this.executor.setTickSource((): number => this.bot.time.age);
    bot.on('physicsTick', (): void => {
      this.probeStuck();
    });
  }

  public async walkTo(goal: Vec3, range: number): AsyncResult<boolean> {
    if (this.bot.entity.position.distanceTo(goal) <= range) return ok(true);

    this.recovery.resetForNewGoal();
    let guard = 0;
    while (guard < 200) {
      guard += 1;
      const bp = this.bot.entity.position;
      const startNode = Collision.destinationNode(
        this.world,
        Math.floor(bp.x),
        Math.floor(bp.y),
        Math.floor(bp.z),
        new Set(),
      );

      const gx = Math.floor(goal.x);
      const gy = Math.floor(goal.y);
      const gz = Math.floor(goal.z);
      const goalNode = Collision.destinationNode(
        this.world,
        gx,
        gy,
        gz,
        new Set(),
      );

      this.runSeq += 1;
      const runId = `nav-${Date.now()}-${this.runSeq}`;
      const expandOpts = config.env.NAV_DIAGONAL
        ? { diagonal: true }
        : undefined;
      const planOp = AStar.search(
        this.world,
        startNode,
        goalNode,
        this.edgeMemory,
        this.bot.time.age,
        runId,
        this.recorder.aStarHooks(),
        (): number => this.bot.time.age,
        expandOpts,
      );
      if (planOp[0] !== null) return ok(false);

      const plan = planOp[1];
      if (plan === null) return fail(new Error('plan'));

      this.edgeMemory.tickDecay(this.bot.time.age);

      this.draining = true;
      this.lastProgressKey = '';
      this.stuckTicks = 0;
      const drainResult = await this.executor.drainQueue(plan.path);

      const dErr = drainResult[0];
      const drain = drainResult[1];
      this.draining = false;
      if (dErr) return [dErr, null];
      if (drain === null) return fail(new Error('drain'));

      if (drain.done) {
        const distNow = this.bot.entity.position.distanceTo(goal);
        if (distNow <= range) return ok(true);
        const pos = this.bot.entity.position;
        const [rErr] = this.recovery.consumeReplan('plan_incomplete', {
          x: Math.floor(pos.x),
          y: Math.floor(pos.y),
          z: Math.floor(pos.z),
        });
        if (rErr) return ok(false);
        continue;
      }

      const pos = this.bot.entity.position;
      const fromPos = {
        x: Math.floor(pos.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z),
      };

      if (drain.phase === 'pre_action') {
        this.recovery.onPreActionRejected(
          drain.action,
          this.bot.time.age,
          drain.reason,
          { fromPos },
        );
        const [rErr] = this.recovery.consumeReplan(drain.reason, fromPos);
        if (rErr) return ok(false);
        continue;
      }

      const [feErr] = this.recovery.recordVerifiedFailure(
        drain.action.from,
        drain.action.to,
        drain.action.kind,
        this.bot.time.age,
        drain.reason,
        drain.phase,
        drain.action,
      );

      if (feErr) return [feErr, null];
      const [rErr2] = this.recovery.consumeReplan(drain.reason, fromPos);
      if (rErr2) return ok(false);
    }

    return ok(false);
  }

  private probeStuck(): void {
    if (!this.draining) return;
    const p = this.bot.entity.position;
    const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

    if (k === this.lastProgressKey) {
      this.stuckTicks += 1;
      if (this.stuckTicks === STUCK_TICKS) {
        this.recovery.notifyStuck(STUCK_TICKS, { x: p.x, y: p.y, z: p.z });
        this.stuckTicks = 0;
      }
      return;
    }
    this.lastProgressKey = k;
    this.stuckTicks = 0;
  }
}
