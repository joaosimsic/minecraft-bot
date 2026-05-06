import type { Bot } from 'mineflayer';
import { Chest } from './Chest';
import { Craft } from './Craft';
import { Door } from './Door';
import { InputHandler } from './InputHandler';
import { Mine } from './Mine';
import { Navigator } from './Navigator';
import { AutoMode } from './modes/AutoMode';
import { GuidedMode } from './modes/GuidedMode';
import { ModeController } from './modes/ModeController';

export class BotKernel {
  public readonly bot: Bot;
  public readonly door: Door;
  public readonly navigator: Navigator;
  public readonly mine: Mine;
  public readonly craft: Craft;
  public readonly chest: Chest;
  public readonly autoMode: AutoMode;
  public readonly guidedMode: GuidedMode;
  public readonly controller: ModeController;
  public readonly input: InputHandler;

  public constructor(bot: Bot) {
    this.bot = bot;
    this.door = new Door(bot);
    this.navigator = new Navigator(bot, this.door);
    this.mine = new Mine(bot);
    this.craft = new Craft(bot);
    this.chest = new Chest(bot);
    this.autoMode = new AutoMode(this.mine, this.craft, this.chest);
    this.guidedMode = new GuidedMode(this.navigator);
    this.controller = new ModeController();
    this.input = new InputHandler(this.controller, this.autoMode, this.guidedMode);
  }
}
