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
    this.input = new InputHandler(this.bot, this.controller, this.autoMode, this.guidedMode);
  }
}
