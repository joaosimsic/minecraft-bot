import { Vec3 } from 'vec3';
import { config, type Env } from './config';

export type Mode = Env['MODE'];

export interface BotState {
  home: Vec3 | null;
  targetY: number;
  miningDir: Vec3;
  busy: boolean;
  shouldStop: boolean;
  forceStop: boolean;
  guidedTarget: Vec3 | null;
  mode: Mode;
}

export const state: BotState = {
  home: config.env.home,
  targetY: config.env.TARGET_Y,
  miningDir: new Vec3(1, 0, 0),
  busy: false,
  shouldStop: false,
  forceStop: false,
  guidedTarget: null,
  mode: config.env.MODE,
};