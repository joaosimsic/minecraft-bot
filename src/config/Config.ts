import { z } from 'zod';
import { Vec3 } from 'vec3';
import { log } from './logger';
import { envSchema, type Env } from './schemas';

const result = envSchema.safeParse(process.env as NodeJS.ProcessEnv);

if (!result.success) {
  log.error('Invalid env vars:\n', z.flattenError(result.error).fieldErrors);
  process.exit(1);
}

const {
  START_X,
  START_Y,
  START_Z,
  GOAL_X,
  GOAL_Y,
  GOAL_Z,
  BOT_USER,
  BOT_USERS,
  ...rest
} = result.data;

const multi =
  BOT_USERS !== undefined && BOT_USERS.length > 0
    ? BOT_USERS.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

const usernames = multi.length > 0 ? multi : [BOT_USER];

export const config = {
  env: {
    ...rest,
    BOT_USER,
    usernames,
    home:
      START_X !== undefined && START_Y !== undefined && START_Z !== undefined
        ? new Vec3(START_X, START_Y, START_Z)
        : null,
    goal:
      GOAL_X !== undefined && GOAL_Y !== undefined && GOAL_Z !== undefined
        ? new Vec3(GOAL_X, GOAL_Y, GOAL_Z)
        : null,
  },
};

export type { Env };
