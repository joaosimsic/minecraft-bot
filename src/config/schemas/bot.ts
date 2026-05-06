import { z } from 'zod';

export const botSchema = {
  USER: z.string().min(1),
  TARGET_Y: z.coerce.number().min(0),
  MODE: z.enum(['auto', 'guided']),
  START_X: z.coerce.number(),
  START_Y: z.coerce.number(),
  START_Z: z.coerce.number(),
};
