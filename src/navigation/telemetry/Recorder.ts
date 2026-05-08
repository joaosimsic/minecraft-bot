import { config } from '../../config';
import { Logger } from '../../shared/Logger';
import { debugLog } from '../../shared/debugLog';
import { getTraceId } from '../../shared/traceContext';
import { parseNodeKey } from '../planner/Node';
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
    if (this.companionEmit === null) return;
    if (type !== NAV_EVENT.MOVEMENT_FAIL) return;
    if (data === undefined) return;
    const msg: Record<string, unknown> = {
      type: 'movement_fail',
      botId: this.botId,
      payload: data,
    };
    const tid = getTraceId();
    if (tid !== undefined) msg.trace_id = tid;
    this.companionEmit(msg);
  }

  public aStarHooks(): AStarTelemetry {
    const trace = config.env.NAV_TRACE;
    const noop = (): void => undefined;
    const heatXZ = new Map<string, number>();

    const bumpHeat = (data: Record<string, unknown>): void => {
      const raw = data['node'];
      if (typeof raw !== 'string') return;
      const op = parseNodeKey(raw);
      if (op[0] !== null) return;
      const n = op[1];
      if (n === null) return;
      const k = `${n.x},${n.z}`;
      heatXZ.set(k, (heatXZ.get(k) ?? 0) + 1);
    };

    const emitHeat = (): void => {
      if (this.companionEmit === null) return;
      if (heatXZ.size === 0) {
        heatXZ.clear();
        return;
      }
      const cells: Record<string, unknown>[] = [];
      for (const [xz, n] of heatXZ) {
        const parts = xz.split(',');
        if (parts.length !== 2) continue;
        const x = Number(parts[0]);
        const z = Number(parts[1]);
        if (!Number.isFinite(x)) continue;
        if (!Number.isFinite(z)) continue;
        cells.push({ x, z, n });
      }
      cells.sort((a, b): number => {
        const bn = b['n'];
        const an = a['n'];
        if (typeof bn !== 'number') return 0;
        if (typeof an !== 'number') return 0;
        return bn - an;
      });
      const cap = cells.slice(0, 400);
      const msg: Record<string, unknown> = {
        type: 'nav_heatmap',
        botId: this.botId,
        cells: cap,
      };
      const tid = getTraceId();
      if (tid !== undefined) msg.trace_id = tid;
      this.companionEmit(msg);
      heatXZ.clear();
    };

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
        heatXZ.clear();
        if (this.companionEmit !== null) {
          const cle: Record<string, unknown> = {
            type: 'nav_heatmap_clear',
            botId: this.botId,
          };
          const tid = getTraceId();
          if (tid !== undefined) cle.trace_id = tid;
          this.companionEmit(cle);
        }
        this.log.event(NAV_EVENT.SEARCH_START, data);
      },

      searchEnd: (data: Record<string, unknown>): void => {
        emitHeat();
        this.log.event(NAV_EVENT.SEARCH_END, data);
        if (data['heuristic_trap'] !== true) return;
        const tid = getTraceId();
        const trapPayload: Record<string, unknown> = {
          expanded: data['expanded'],
          manhattan: data['manhattan'],
          ratio: data['heuristic_ratio'],
          threshold: config.env.NAV_HEURISTIC_TRAP_THRESHOLD,
          runId: data['runId'],
          botId: this.botId,
        };
        if (tid !== undefined) trapPayload.trace_id = tid;
        this.log.event('heuristic_trap', trapPayload);
        debugLog(
          'Recorder.ts:heuristic_trap',
          'heuristic trap',
          trapPayload,
          'HT',
        );
      },

      nodeExpand: (data: Record<string, unknown>): void => {
        bumpHeat(data);
        if (!trace) return;
        this.log.event(NAV_EVENT.NODE_EXPAND, data);
      },

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
