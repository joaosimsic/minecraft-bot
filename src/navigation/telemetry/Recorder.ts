import { Logger } from '../../shared/Logger';
import { NAV_EVENT } from './Events';
import type { AStarTelemetry } from '../planner/AStar';

export class NavigationRecorder {
  public constructor(private readonly log: Logger) {}

  public emit(type: string, data?: Record<string, unknown>): void {
    this.log.event(type, data);
  }

  public aStarHooks(): AStarTelemetry {
    return {
      searchStart: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.SEARCH_START, data);
      },

      searchEnd: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.SEARCH_END, data);
      },

      nodeExpand: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.NODE_EXPAND, data);
      },

      pathSelected: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.PATH_SELECTED, data);
      },

      candidateGenerated: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.CANDIDATE_GENERATED, data);
      },

      candidateRejected: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.CANDIDATE_REJECTED, data);
      },
    };
  }
}
