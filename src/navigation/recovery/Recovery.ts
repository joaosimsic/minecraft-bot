import type { Result } from '../../shared/result';
import { fail, okVoid } from '../../shared/result';
import type { NodeKey } from '../planner/Node';
import type { ActionKind } from '../movement/Actions';
import type { NavigationAction } from '../movement/Actions';
import { EdgeMemory } from './EdgeMemory';
import { NAV_EVENT, type MovementPhase } from '../telemetry/Events';
import { NavigationRecorder } from '../telemetry/Recorder';
import { SearchEdge } from '../planner/Edge';

export type RecoveryState = 'EXECUTING' | 'VALIDATE_FAIL' | 'REPLAN';

export class Recovery {
  private state: RecoveryState = 'EXECUTING';
  private replansUsed = 0;

  public constructor(
    private readonly replanBudget: number,
    private readonly memory: EdgeMemory,
    private readonly recorder: NavigationRecorder,
  ) {}

  public resetForNewGoal(): void {
    this.replansUsed = 0;
    this.state = 'EXECUTING';
  }

  public canReplan(): boolean {
    return this.replansUsed < this.replanBudget;
  }

  public consumeReplan(
    reason: string,
    fromPos: Record<string, number>,
  ): Result<null> {
    if (!this.canReplan()) return fail(new Error('replan_budget'));

    this.replansUsed += 1;
    this.recorder.emit(NAV_EVENT.REPLAN, { reason, fromPos });
    this.state = 'EXECUTING';
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
  ): Result<null> {
    this.state = 'VALIDATE_FAIL';

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
    });

    this.state = 'REPLAN';
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

  public markExecuting(): void {
    this.state = 'EXECUTING';
  }

  public getState(): RecoveryState {
    return this.state;
  }
}
