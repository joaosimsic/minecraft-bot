import { z } from 'zod';

export const botSchema = {
  BOT_USER: z.string().min(1),
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
};
