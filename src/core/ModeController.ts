import { Logger } from '../shared/Logger';
import type { BotMode } from '../modes/BotMode';
import { IdleMode } from '../modes/IdleMode';

export class ModeController {
  private readonly log = new Logger('ModeController');
  private currentMode: BotMode = new IdleMode();
  private active = true;

  public switchTo(mode: BotMode): void {
    this.log.info('mode ->', mode.constructor.name);
    this.currentMode = mode;
  }

  public stop(): void {
    this.log.info('pausing');
    this.currentMode = new IdleMode();
  }

  public halt(): void {
    this.log.info('halting');
    this.active = false;
  }

  public async run(): Promise<void> {
    while (this.active) {
      await this.currentMode.tick();
    }
  }
}
