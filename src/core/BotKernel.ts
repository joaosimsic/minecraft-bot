import type { Bot } from 'mineflayer';
import { Chest } from '../skills/Chest';
import { Craft } from '../skills/Craft';
import { Door } from '../skills/Door';
import { Mine } from '../skills/Mine';
import { Navigator } from '../skills/Navigator';
import { AutoMode } from '../modes/AutoMode';
import { GuidedMode } from '../modes/GuidedMode';
import { ModeController } from './ModeController';
import { Telemetry } from './Telemetry';
import { config } from '../config';
import { NavigationController } from '../navigation/NavigationController';
import { BotRuntimeContext } from './BotRuntimeContext';
import { Logger } from '../shared/Logger';
import { Metrics } from '../shared/Metrics';

export class BotKernel {
  private readonly touchStatusThrottled: () => void;

  public readonly bot: Bot;
  public readonly botId: string;
  public readonly metrics: Metrics;
  public readonly runtime: BotRuntimeContext;
  public readonly door: Door;
  private readonly navigation: NavigationController;
  public readonly navigator: Navigator;
  public readonly mine: Mine;
  public readonly craft: Craft;
  public readonly chest: Chest;
  public readonly autoMode: AutoMode;
  public readonly guidedMode: GuidedMode;
  public readonly controller: ModeController;
  public readonly telemetry: Telemetry;

  public constructor(bot: Bot, botId: string, onModeUi: () => void) {
    this.bot = bot;
    this.botId = botId;
    this.metrics = new Metrics();
    this.runtime = new BotRuntimeContext(config.env);
    this.door = new Door(bot, botId, this.metrics);
    this.navigation = new NavigationController(bot, botId);
    this.navigator = new Navigator(bot, this.navigation, botId, this.metrics);
    this.mine = new Mine(bot, this.navigator, botId, this.metrics);
    this.craft = new Craft(bot, botId);
    this.chest = new Chest(bot, botId);
    this.autoMode = new AutoMode(
      this.mine,
      this.craft,
      this.chest,
      this.runtime,
    );
    this.guidedMode = new GuidedMode(
      this.navigator,
      config.env.goal,
      botId,
      this.metrics,
    );
    this.controller = new ModeController(
      new Logger('ModeController', botId),
      this.metrics,
      onModeUi,
    );
    this.telemetry = new Telemetry(
      this.bot,
      config.env.LOG_SAMPLE_MS,
      config.env.LOG_STATS_MS,
      config.env.LOG_TRAIL_MIN_BLOCKS,
      botId,
      this.metrics,
    );
    this.telemetry.start();
    let lastEmit = 0;
    this.touchStatusThrottled = (): void => {
      const now = Date.now();
      if (now - lastEmit < 200) return;
      lastEmit = now;
      onModeUi();
    };
    this.bot.on('move', this.touchStatusThrottled);
    this.bot.on('physicTick', this.touchStatusThrottled);
    this.bot.on('spawn', () => this.guidedMode.onRespawn());
  }
}
