import { Utils } from '../Utils';
import type { BotMode } from './BotMode';

export class IdleMode implements BotMode {
  public async tick(): Promise<void> {
    await Utils.sleep(1000);
  }
}
