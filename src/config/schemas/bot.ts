import { z } from 'zod';

export const botSchema = {
  BOT_USER: z.string().min(1),
  BOT_USERS: z.string().optional(),
  AUTH: z.enum(['offline', 'microsoft', 'mojang']),

  TARGET_Y: z.coerce.number().min(0),
  MODE: z.enum(['auto', 'guided']),
  START_X: z.coerce.number().optional(),
  START_Y: z.coerce.number().optional(),
  START_Z: z.coerce.number().optional(),
  GOAL_X: z.coerce.number().optional(),
  GOAL_Y: z.coerce.number().optional(),
  GOAL_Z: z.coerce.number().optional(),

  LOG_DIR: z.string().min(1).default('logs'),
  LOG_SAMPLE_MS: z.coerce.number().min(100).default(1000),
  LOG_STATS_MS: z.coerce.number().min(500).default(10000),
  LOG_TRAIL_MIN_BLOCKS: z.coerce.number().min(0.05).default(0.5),

  NAV_DIAGONAL: z
    .enum(['0', '1'])
    .default('0')
    .transform((s): boolean => s === '1'),
  NAV_TRACE: z
    .enum(['0', '1'])
    .default('0')
    .transform((s): boolean => s === '1'),
  NAV_EDGE_MEMORY_FILE: z.string().min(1).optional(),
  NAV_EDGE_MEMORY_MAX_ENTRIES: z.coerce.number().int().min(1).default(4000),
  NAV_EDGE_MEMORY_SAVE_EVERY_FAILURES: z.coerce
    .number()
    .int()
    .min(1)
    .default(10),
  NAV_MAX_EXPANSIONS: z.coerce.number().int().min(100).default(20000),
  NAV_HEURISTIC_WEIGHT: z.coerce.number().min(1).default(1.5),
  NAV_HEURISTIC_TRAP_THRESHOLD: z.coerce.number().min(1).default(50),
  NAV_YIELD_EVERY: z.coerce.number().int().min(0).default(256),

  REPLAY_JSONL: z.string().min(1).optional(),

  WEB_BIND: z.string().min(1).default('127.0.0.1'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WEB_COMPANION: z.enum(['0', '1']).optional(),

  TELEMETRY_ENDPOINT: z.preprocess(
    (v): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional(),
  ),
  TELEMETRY_SESSION_ID: z.preprocess(
    (v): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  TELEMETRY_SERVICE_NAME: z.preprocess(
    (v): unknown =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : 'minecraft-bot',
    z.string().min(1),
  ),
  TELEMETRY_METRICS_EXPORT_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .default(30_000),
};
