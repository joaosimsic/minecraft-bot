import { Vec3 } from 'vec3';
import { Utils } from '../Utils';
import type { BotMode } from './BotMode';
import type { Navigator } from '../Navigator';

export class GuidedMode implements BotMode {
  private target: Vec3 | null = null;

  public constructor(private readonly navigator: Navigator) {}

  public setTarget(target: Vec3): void {
    this.target = target;
  }

  public async tick(): Promise<void> {
    const t = this.target;
    if (t === null) {
      await Utils.sleep(1000);
      return;
    }
    await this.navigator.walkTo(t);
    this.target = null;
  }
}
