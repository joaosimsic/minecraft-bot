import { z } from 'zod';

export const botSchema = {
  BOT_USER: z.string().min(1),
  AUTH: z.enum(['offline', 'microsoft', 'mojang']),
  TARGET_Y: z.coerce.number().min(0),
  MODE: z.enum(['auto', 'guided']),
  START_X: z.coerce.number().optional(),
  START_Y: z.coerce.number().optional(),
  START_Z: z.coerce.number().optional(),
};
