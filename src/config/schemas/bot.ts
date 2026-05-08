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

  REPLAY_JSONL: z.string().min(1).optional(),

  WEB_BIND: z.string().min(1).default('127.0.0.1'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WEB_COMPANION: z.enum(['0', '1']).optional(),
};
