import { z } from 'zod';

const envBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((v): boolean => v === 'true' || v === '1');

export const proxySchema = {
  VIAPROXY_VERSION: z.string().min(1),

  VIAPROXY_PORT: z.coerce.number().min(1),
  CLIENT_VERSION: z.string().min(1),

  DISABLE_PROXY: envBoolean,
  FORCE_PROXY: envBoolean,
};
