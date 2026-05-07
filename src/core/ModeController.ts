import { Logger } from '../shared/Logger';
import { metrics } from '../shared/Metrics';
import type { BotMode } from '../modes/BotMode';
import { IdleMode } from '../modes/IdleMode';

export class ModeController {
  private readonly log = new Logger('ModeController');
  private currentMode: BotMode = new IdleMode();
  private active = true;

  public switchTo(mode: BotMode): void {
    const from = this.currentMode.constructor.name;
    const to = mode.constructor.name;
    metrics.inc('mode.switch');
    this.log.info('mode ->', to);
    this.log.decision('mode_switch', 'controller_request', { from, to });
    this.log.event('mode_switch', { from, to });
    this.currentMode = mode;
  }

  public stop(): void {
    metrics.inc('mode.stop');
    this.log.info('pausing');
    this.log.decision('mode_stop', 'controller_request', { from: this.currentMode.constructor.name });
    this.log.event('mode_stop', { from: this.currentMode.constructor.name });
    this.currentMode = new IdleMode();
  }

  public halt(): void {
    this.log.info('halting');
    this.log.event('halt');
    this.active = false;
  }

  public async run(): Promise<void> {
    while (this.active) {
      await this.currentMode.tick();
    }
  }
}
