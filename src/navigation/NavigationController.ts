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
import { debugLog } from '../shared/debugLog';

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
      // #region agent log
      debugLog(
        'NavigationController.ts:walkTo:snapNull',
        'goal_unsnappable',
        { goalIn: { x: goalIn.x, y: goalIn.y, z: goalIn.z }, rangeIn },
        'H1',
      );
      // #endregion
      this.log.warn('plan_failed', 'goal_unsnappable');
      return ok(false);
    }
    const goal = snap.goal;
    const range = snap.range;

    // #region agent log
    debugLog(
      'NavigationController.ts:walkTo:snapResult',
      'goal snapped',
      {
        goalIn: { x: goalIn.x, y: goalIn.y, z: goalIn.z },
        snappedGoal: { x: goal.x, y: goal.y, z: goal.z },
        range,
        rangeIn,
        goalChanged:
          goalIn.x !== goal.x || goalIn.y !== goal.y || goalIn.z !== goal.z,
      },
      'H2',
    );
    // #endregion

    if (this.bot.entity.position.distanceTo(goal) <= range) return ok(true);

    this.recovery.resetForNewGoal();
    let guard = 0;
    while (guard < 200) {
      guard += 1;

      // #region agent log
      const _pre = this.bot.entity.position;
      const _vel = this.bot.entity.velocity;
      const _og = (this.bot.entity as Record<string, unknown>).onGround;
      debugLog(
        'NavigationController.ts:walkTo:loopTop',
        'loop iteration start',
        {
          guard,
          pos: {
            x: +_pre.x.toFixed(2),
            y: +_pre.y.toFixed(4),
            z: +_pre.z.toFixed(2),
          },
          vel: _vel
            ? {
                x: +_vel.x.toFixed(4),
                y: +_vel.y.toFixed(4),
                z: +_vel.z.toFixed(4),
              }
            : null,
          onGround: _og,
        },
        'H13',
      );
      // #endregion

      const bp = this.bot.entity.position;
      let startNode = Collision.destinationNode(
        this.world,
        Math.floor(bp.x),
        Math.floor(bp.y),
        Math.floor(bp.z),
        new Set(),
      );
      if (!Collision.canStandAt(this.world, startNode)) {
        // #region agent log
        const _bx = Math.floor(bp.x),
          _by = Math.floor(bp.y),
          _bz = Math.floor(bp.z);
        const _probes: Record<string, unknown>[] = [];
        for (let _dy = -3; _dy <= 2; _dy++) {
          const _py = _by + _dy;
          const _mc = this.world.footMovementClass(_bx, _py, _bz);
          const _c = this.world.cell(_bx, _py, _bz);
          const _n = Collision.destinationNode(
            this.world,
            _bx,
            _py,
            _bz,
            new Set(),
          );
          const _cs = Collision.canStandAt(this.world, _n);
          const _blk = this.bot.blockAt(new Vec3(_bx, _py, _bz));
          _probes.push({
            y: _py,
            mc: _mc,
            cell: _c,
            key: _n.key,
            canStand: _cs,
            blkName: _blk?.name ?? 'NULL',
            blkBB: _blk?.boundingBox ?? 'NULL',
            blkId: _blk?.type ?? -1,
          });
        }
        debugLog(
          'NavigationController.ts:walkTo:snapProbe',
          'start not standable, probing column',
          {
            bpRaw: {
              x: +bp.x.toFixed(2),
              y: +bp.y.toFixed(2),
              z: +bp.z.toFixed(2),
            },
            probes: _probes,
          },
          'H10',
        );
        // #endregion

        const entityOnGround = (this.bot.entity as Record<string, unknown>)
          .onGround;
        if (entityOnGround !== true) {
          const snapped = Collision.findStandableNear(
            this.world,
            Math.floor(bp.x),
            Math.floor(bp.y),
            Math.floor(bp.z),
            2,
            1,
          );
          if (snapped === null) {
            // #region agent log
            debugLog(
              'NavigationController.ts:walkTo:startNotStandable',
              'start_not_standable',
              {
                bpx: Math.floor(bp.x),
                bpy: Math.floor(bp.y),
                bpz: Math.floor(bp.z),
              },
              'H2',
            );
            // #endregion
            this.log.warn('plan_failed', 'start_not_standable');
            return ok(false);
          }
          startNode = snapped;
        }

        // #region agent log
        debugLog(
          'NavigationController.ts:walkTo:startResolution',
          'start node resolved',
          {
            entityOnGround,
            usedActualPos: entityOnGround === true,
            startKey: startNode.key,
            bpRaw: {
              x: +bp.x.toFixed(2),
              y: +bp.y.toFixed(2),
              z: +bp.z.toFixed(2),
            },
          },
          'H16',
        );
        // #endregion
      }

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

      // #region agent log
      const _footMc = this.world.footMovementClass(
        startNode.x,
        startNode.y,
        startNode.z,
      );
      const _footCell = this.world.cell(startNode.x, startNode.y, startNode.z);
      const _belowCell = this.world.cell(
        startNode.x,
        startNode.y - 1,
        startNode.z,
      );
      const _belowMc = this.world.footMovementClass(
        startNode.x,
        startNode.y - 1,
        startNode.z,
      );
      debugLog(
        'NavigationController.ts:walkTo:startInfo',
        'start node details',
        {
          startKey: startNode.key,
          startMc: startNode.movementClass,
          footMcNow: _footMc,
          footCell: _footCell,
          belowCell: _belowCell,
          belowMc: _belowMc,
          goalKey: goalNode.key,
          bpRaw: {
            x: +bp.x.toFixed(2),
            y: +bp.y.toFixed(2),
            z: +bp.z.toFixed(2),
          },
        },
        'H9',
      );
      // #endregion

      // #region agent log
      const _fwdProbe: Record<string, unknown>[] = [];
      const _goalDz = Math.sign(gz - startNode.z);
      const _goalDx = Math.sign(gx - startNode.x);
      for (let _step = 0; _step <= 15; _step++) {
        const _sz = startNode.z + _step * (_goalDz || 1);
        const _sx = startNode.x + _step * _goalDx;
        for (let _dy = -2; _dy <= 2; _dy++) {
          const _sy = startNode.y + _dy;
          const _c = this.world.cell(_sx, _sy, _sz);
          const _n = Collision.destinationNode(
            this.world,
            _sx,
            _sy,
            _sz,
            new Set(),
          );
          const _cs = Collision.canStandAt(this.world, _n);
          _fwdProbe.push({
            step: _step,
            dx: _step * _goalDx,
            dy: _dy,
            dz: _step * (_goalDz || 1),
            cell: _c,
            canStand: _cs,
            key: _n.key,
          });
        }
      }
      debugLog(
        'NavigationController.ts:walkTo:forwardTerrain',
        'terrain profile toward goal',
        { startKey: startNode.key, goalKey: goalNode.key, fwdProbe: _fwdProbe },
        'H1',
      );
      // #endregion

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
          heuristicWeight: config.env.NAV_HEURISTIC_WEIGHT,
          yieldEvery:
            config.env.REPLAY_JSONL !== undefined
              ? 0
              : config.env.NAV_YIELD_EVERY,
        },
      );
      if (planOp[0] !== null) {
        // #region agent log
        debugLog(
          'NavigationController.ts:walkTo:planFailed',
          'astar_failed',
          {
            err: planOp[0].message,
            startKey: startNode.key,
            goalKey: goalNode.key,
            guard,
          },
          'H3',
        );
        // #endregion
        this.log.warn('plan_failed', planOp[0].message);
        return ok(false);
      }

      const plan = planOp[1];
      if (plan === null) return fail(new Error('plan'));

      if (plan.partial) {
        this.log.info(
          'partial path',
          `${plan.path.length} steps, expanded ${plan.nodesExpanded}`,
        );
      }

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

        if (plan.partial) {
          // #region agent log
          debugLog(
            'NavigationController.ts:walkTo:partialDrained',
            'partial path drained, replanning',
            {
              distNow,
              range,
              guard,
              pos: {
                x: Math.floor(pos.x),
                y: Math.floor(pos.y),
                z: Math.floor(pos.z),
              },
            },
            'H11',
          );
          // #endregion
          continue;
        }

        // #region agent log
        debugLog(
          'NavigationController.ts:walkTo:planIncomplete',
          'drain done but not in range',
          {
            distNow,
            range,
            guard,
            pos: {
              x: Math.floor(pos.x),
              y: Math.floor(pos.y),
              z: Math.floor(pos.z),
            },
          },
          'H4',
        );
        // #endregion
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

      // #region agent log
      debugLog(
        'NavigationController.ts:walkTo:drainFail',
        'executor rejected',
        { phase: drain.phase, reason: drain.reason, guard },
        'H4',
      );
      // #endregion

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

    const snapped = Collision.findStandableNear(this.world, gx, gy, gz, 8, 8);
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
