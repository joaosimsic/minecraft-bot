import { Vec3 } from 'vec3';

export interface BotState {
  home: Vec3 | null;
  targetY: number;
  miningDir: Vec3;
  busy: boolean;
  shouldStop: boolean;
  forceStop: boolean;
  guidedTarget: Vec3 | null;
  mode: 'auto' | 'guided';
}

export const state: BotState = {
  home: null,
  targetY: 12,
  miningDir: new Vec3(1, 0, 0),
  busy: false,
  shouldStop: false,
  forceStop: false,
  guidedTarget: null,
  mode: 'auto',
};
