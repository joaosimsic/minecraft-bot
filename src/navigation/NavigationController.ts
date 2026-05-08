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
import { Vec3 } from 'vec3';
import { config } from '../config';
import { Logger } from '../shared/Logger';

const REPLAN_BUDGET = 14;
const TRANSIENT_REPLAN_BUDGET = 6;
const STUCK_TICKS = 36;

export class NavigationController {
  private readonly log: Logger;
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
    botId: string,
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
    this.log = new Logger('navigation', botId);
    this.recorder = new NavigationRecorder(this.log);
    this.recovery = new Recovery(
      REPLAN_BUDGET,
      TRANSIENT_REPLAN_BUDGET,
      this.edgeMemory,
      this.recorder,
    );
    this.executor = new NavigationExecutor(
      bot,
      this.world,
      this.validator,
      this.recorder,
    );
    this.executor.setTickSource((): number => this.bot.time.age);
  }

  private readonly onPhysicsProbe = (): void => this.probeStuck();

  public async walkTo(goalIn: Vec3, rangeIn: number): AsyncResult<boolean> {
    const snap = this.snapGoal(goalIn, rangeIn);
    if (snap === null) {
      this.log.warn('plan_failed', 'goal_unsnappable');
      return ok(false);
    }
    const goal = snap.goal;
    const range = snap.range;

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
      const planOp = await AStar.search(
        this.world,
        startNode,
        goalNode,
        this.edgeMemory,
        this.bot.time.age,
        runId,
        this.recorder.aStarHooks(),
        (): number => this.bot.time.age,
        expandOpts,
        {
          maxExpansions: config.env.NAV_MAX_EXPANSIONS,
          yieldEvery:
            config.env.REPLAY_JSONL !== undefined
              ? 0
              : config.env.NAV_YIELD_EVERY,
        },
      );
      if (planOp[0] !== null) {
        this.log.warn('plan_failed', planOp[0].message);
        return ok(false);
      }

      const plan = planOp[1];
      if (plan === null) return fail(new Error('plan'));

      this.edgeMemory.tickDecay(this.bot.time.age);

      this.draining = true;
      this.lastProgressKey = '';
      this.stuckTicks = 0;
      this.bot.on('physicsTick', this.onPhysicsProbe);
      const drainResult = await this.executor.drainQueue(plan.path);
      this.bot.removeListener('physicsTick', this.onPhysicsProbe);

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
        if (rErr) return [rErr, null];
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
          drain.observed,
        );
        const [rErr] = this.recovery.consumeTransientReplan(
          drain.reason,
          fromPos,
        );
        if (rErr) return [rErr, null];
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
        drain.observed,
      );

      if (feErr) return [feErr, null];
      const [rErr2] = this.recovery.consumeReplan(drain.reason, fromPos);
      if (rErr2) return [rErr2, null];
    }

    return ok(false);
  }

  private snapGoal(
    goalIn: Vec3,
    rangeIn: number,
  ): { goal: Vec3; range: number } | null {
    const gx = Math.floor(goalIn.x);
    const gy = Math.floor(goalIn.y);
    const gz = Math.floor(goalIn.z);
    const direct = Collision.destinationNode(this.world, gx, gy, gz, new Set());
    if (Collision.canStandAt(this.world, direct)) {
      return { goal: goalIn, range: rangeIn };
    }

    const snapped = Collision.findStandableNear(this.world, gx, gy, gz, 8);
    if (snapped === null) return null;

    const newGoal = new Vec3(snapped.x + 0.5, snapped.y, snapped.z + 0.5);
    const dist = newGoal.distanceTo(goalIn);
    const newRange = Math.max(rangeIn, dist + 0.5);
    return { goal: newGoal, range: newRange };
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
