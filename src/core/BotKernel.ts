import type { Bot } from 'mineflayer';
import { Chest } from '../skills/Chest';
import { Craft } from '../skills/Craft';
import { Door } from '../skills/Door';
import { InputHandler } from './InputHandler';
import { Mine } from '../skills/Mine';
import { Navigator } from '../skills/Navigator';
import { AutoMode } from '../modes/AutoMode';
import { GuidedMode } from '../modes/GuidedMode';
import { ModeController } from './ModeController';
import { Telemetry } from './Telemetry';
import { config } from '../config';
import { NavigationController } from '../navigation/NavigationController';

export class BotKernel {
  public readonly bot: Bot;
  public readonly door: Door;
  private readonly navigation: NavigationController;
  public readonly navigator: Navigator;
  public readonly mine: Mine;
  public readonly craft: Craft;
  public readonly chest: Chest;
  public readonly autoMode: AutoMode;
  public readonly guidedMode: GuidedMode;
  public readonly controller: ModeController;
  public readonly input: InputHandler;
  public readonly telemetry: Telemetry;

  public constructor(bot: Bot) {
    this.bot = bot;
    this.door = new Door(bot);
    this.navigation = new NavigationController(bot, 'navigation');
    this.navigator = new Navigator(bot, this.navigation);
    this.mine = new Mine(bot, this.navigator);
    this.craft = new Craft(bot);
    this.chest = new Chest(bot);
    this.autoMode = new AutoMode(this.mine, this.craft, this.chest);
    this.guidedMode = new GuidedMode(this.navigator, config.env.goal);
    this.controller = new ModeController();
    this.input = new InputHandler(this.bot, this.controller, this.autoMode, this.guidedMode);

    this.telemetry = new Telemetry(
      this.bot,
      config.env.LOG_SAMPLE_MS,
      config.env.LOG_STATS_MS,
      config.env.LOG_TRAIL_MIN_BLOCKS,
    );
    this.telemetry.start();
    this.bot.on('spawn', () => this.guidedMode.onRespawn());
  }
}
