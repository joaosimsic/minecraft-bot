import { z } from 'zod';

export const serverSchema = {
  HOST: z.string().min(1),
  PORT: z.coerce.number().min(1),
  VERSION: z.string().min(1),
};
