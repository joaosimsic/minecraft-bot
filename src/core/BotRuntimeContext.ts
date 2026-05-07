import { Vec3 } from 'vec3';

export type RuntimeEnvSlice = {
  TARGET_Y: number;
  home: Vec3 | null;
};

export class BotRuntimeContext {
  public home: Vec3 | null;
  public targetY: number;
  public miningDir: Vec3;
  public busy: boolean;

  public constructor(env: RuntimeEnvSlice) {
    this.home = env.home;
    this.targetY = env.TARGET_Y;
    this.miningDir = new Vec3(1, 0, 0);
    this.busy = false;
  }
}
