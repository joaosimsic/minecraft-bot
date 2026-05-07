import type { Result } from '../../shared/result';
import { fail, okVoid } from '../../shared/result';
import type { NodeKey } from '../planner/Node';
import type { ActionKind } from '../movement/Actions';
import type { NavigationAction } from '../movement/Actions';
import { EdgeMemory } from './EdgeMemory';
import { NAV_EVENT, type MovementPhase } from '../telemetry/Events';
import { NavigationRecorder } from '../telemetry/Recorder';
import { SearchEdge } from '../planner/Edge';

export class Recovery {
  private replansUsed = 0;
  private transientReplansUsed = 0;

  public constructor(
    private readonly replanBudget: number,
    private readonly transientReplanBudget: number,
    private readonly memory: EdgeMemory,
    private readonly recorder: NavigationRecorder,
  ) {}

  public resetForNewGoal(): void {
    this.replansUsed = 0;
    this.transientReplansUsed = 0;
  }

  public canReplan(): boolean {
    return this.replansUsed < this.replanBudget;
  }

  public canTransientReplan(): boolean {
    return this.transientReplansUsed < this.transientReplanBudget;
  }

  public consumeReplan(
    reason: string,
    fromPos: Record<string, number>,
  ): Result<null> {
    if (!this.canReplan()) return fail(new Error('replan_budget'));

    this.replansUsed += 1;
    this.recorder.emit(NAV_EVENT.REPLAN, { reason, fromPos });
    return okVoid();
  }

  public consumeTransientReplan(
    reason: string,
    fromPos: Record<string, number>,
  ): Result<null> {
    if (!this.canTransientReplan())
      return fail(new Error('transient_replan_budget'));

    this.transientReplansUsed += 1;
    this.recorder.emit(NAV_EVENT.REPLAN, { reason, fromPos });
    return okVoid();
  }

  public recordVerifiedFailure(
    fromKey: NodeKey,
    toKey: NodeKey,
    kind: ActionKind,
    tick: number,
    reason: string,
    phase: MovementPhase,
    action: NavigationAction,
    observed?: Record<string, unknown>,
  ): Result<null> {
    const row = this.memory.recordFailure(fromKey, toKey, kind, tick);

    this.recorder.emit(NAV_EVENT.EDGE_PENALIZED, {
      edge: { id: SearchEdge.stableId(fromKey, toKey, kind) },
      failureCount: row.failureCount,
      penalty: row.learnedAdd,
    });

    this.recorder.emit(NAV_EVENT.MOVEMENT_FAIL, {
      action: action.toTelemetry(),
      reason,
      tick,
      phase,
      observed,
    });

    return okVoid();
  }

  public onPreActionRejected(
    next: NavigationAction,
    tick: number,
    reason: string,
    observed?: Record<string, unknown>,
  ): void {
    this.recorder.emit(NAV_EVENT.PRE_ACTION_REJECTED, {
      next_action: next.toTelemetry(),
      reason,
      tick,
      observed,
    });
  }

  public notifyStuck(
    windowTicks: number,
    lastProgressPos: Record<string, number>,
  ): void {
    this.recorder.emit(NAV_EVENT.STUCK_DETECTED, {
      windowTicks,
      lastProgressPos,
    });
  }
}
