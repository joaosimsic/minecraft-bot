import { z } from 'zod';
import { botSchema } from './bot';
import { proxySchema } from './proxy';
import { serverSchema } from './server';

export const envSchema = z.object({
  ...botSchema,
  ...proxySchema,
  ...serverSchema,
});

export type Env = z.infer<typeof envSchema>;
