import { Logger } from '../shared/Logger';
import type { Metrics } from '../shared/Metrics';
import type { BotMode } from '../modes/BotMode';
import { IdleMode } from '../modes/IdleMode';

export class ModeController {
  private currentMode: BotMode = new IdleMode();
  private active = true;

  public constructor(
    private readonly log: Logger,
    private readonly metrics: Metrics,
    private readonly onModeUi: () => void,
  ) {}

  public modeLabel(): string {
    return this.currentMode.constructor.name;
  }

  public switchTo(mode: BotMode): void {
    const from = this.currentMode.constructor.name;
    const to = mode.constructor.name;
    this.metrics.inc('mode.switch');
    this.log.info('mode ->', to);
    this.log.decision('mode_switch', 'controller_request', { from, to });
    this.log.event('mode_switch', { from, to });

    this.currentMode = mode;
    this.onModeUi();
  }

  public stop(): void {
    this.metrics.inc('mode.stop');
    this.log.info('pausing');
    this.log.decision('mode_stop', 'controller_request', {
      from: this.currentMode.constructor.name,
    });
    this.log.event('mode_stop', { from: this.currentMode.constructor.name });

    this.currentMode = new IdleMode();
    this.onModeUi();
  }

  public halt(): void {
    this.log.info('halting');
    this.log.event('halt');
    this.active = false;
    this.onModeUi();
  }

  public isIdle(): boolean {
    if (!this.active) return true;
    return this.currentMode instanceof IdleMode;
  }

  public async run(): Promise<void> {
    while (this.active) {
      await this.currentMode.tick();
    }
  }
}
