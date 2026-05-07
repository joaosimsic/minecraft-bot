export const NAV_EVENT = {
  SEARCH_START: 'search_start',
  SEARCH_END: 'search_end',
  NODE_EXPAND: 'node_expand',
  CANDIDATE_GENERATED: 'candidate_generated',
  CANDIDATE_REJECTED: 'candidate_rejected',
  PATH_SELECTED: 'path_selected',

  PRE_ACTION_REJECTED: 'pre_action_rejected',
  MOVEMENT_START: 'movement_start',
  MOVEMENT_TICK: 'movement_tick',
  MOVEMENT_COMPLETE: 'movement_complete',
  MOVEMENT_FAIL: 'movement_fail',
  EDGE_PENALIZED: 'edge_penalized',
  REPLAN: 'replan',
  STUCK_DETECTED: 'stuck_detected',
} as const;

export type SearchStartPayload = {
  start: string;
  goal: string;
  tick: number;
  runId: string;
};

export type SearchEndPayload = {
  status: 'ok' | 'fail' | 'aborted';
  expanded?: number;
  cost?: number | null;
  reason?: string;
  durationTicks?: number;
};

export type MovementPhase = 'pre_action' | 'post_action' | 'macro';

export type MovementFailPayload = {
  action: Record<string, unknown>;
  reason: string;
  observed?: Record<string, unknown>;
  phase: MovementPhase;
  tick?: number;
};

export type EdgePenalizedPayload = {
  edge: Record<string, unknown>;
  failureCount: number;
  penalty: number;
};
