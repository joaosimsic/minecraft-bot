import { Vec3 } from 'vec3';
import { config } from './config';

export interface BotState {
  home: Vec3 | null;
  targetY: number;
  miningDir: Vec3;
  busy: boolean;
}

export const state: BotState = {
  home: config.env.home,
  targetY: config.env.TARGET_Y,
  miningDir: new Vec3(1, 0, 0),
  busy: false,
};
