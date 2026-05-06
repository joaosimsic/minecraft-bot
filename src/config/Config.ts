import { z } from 'zod';
import { envSchema, type Env } from './schemas';

const result = envSchema.safeParse(process.env as Record<string, unknown>);

if (!result.success) {
  console.error(
    'Invalid env vars:\n',
    z.flattenError(result.error).fieldErrors,
  );
  process.exit(1);
}

export const config = { env: result.data };
export type { Env };
