import { config } from '../../config';
import { Logger } from '../../shared/Logger';
import { getTraceId } from '../../shared/traceContext';
import { NAV_EVENT } from './Events';
import type { AStarTelemetry } from '../planner/AStar';

export class NavigationRecorder {
  public constructor(
    private readonly log: Logger,
    private readonly botId: string,
    private readonly companionEmit:
      | ((msg: Record<string, unknown>) => void)
      | null,
  ) {}

  public emit(type: string, data?: Record<string, unknown>): void {
    this.log.event(type, data);
  }

  public aStarHooks(): AStarTelemetry {
    const trace = config.env.NAV_TRACE;
    const noop = (): void => undefined;
    const emitNav = (
      navKind: 'path_selected' | 'candidate_rejected',
      data: Record<string, unknown>,
    ): void => {
      if (this.companionEmit === null) return;
      const msg: Record<string, unknown> = {
        type: 'nav_trace',
        navKind,
        botId: this.botId,
        data,
      };
      const tid = getTraceId();
      if (tid !== undefined) msg.trace_id = tid;
      this.companionEmit(msg);
    };

    return {
      searchStart: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.SEARCH_START, data);
      },

      searchEnd: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.SEARCH_END, data);
      },

      nodeExpand: trace
        ? (data: Record<string, unknown>): void => {
            this.log.event(NAV_EVENT.NODE_EXPAND, data);
          }
        : noop,

      pathSelected: (data: Record<string, unknown>): void => {
        this.log.event(NAV_EVENT.PATH_SELECTED, data);
        if (trace) emitNav('path_selected', data);
      },

      candidateGenerated: trace
        ? (data: Record<string, unknown>): void => {
            this.log.event(NAV_EVENT.CANDIDATE_GENERATED, data);
          }
        : noop,

      candidateRejected: trace
        ? (data: Record<string, unknown>): void => {
            this.log.event(NAV_EVENT.CANDIDATE_REJECTED, data);
            emitNav('candidate_rejected', data);
          }
        : noop,
    };
  }
}
