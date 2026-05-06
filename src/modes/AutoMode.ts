import type { BotMode } from './BotMode';
import type { Mine } from '../Mine';
import type { Craft } from '../Craft';
import type { Chest } from '../Chest';
import { state } from '../state';

export class AutoMode implements BotMode {
  public constructor(
    private readonly mine: Mine,
    private readonly craft: Craft,
    private readonly chest: Chest,
  ) {}

  public async tick(): Promise<void> {
    await this.craft.ensureTools();
    await this.craft.craftTorches();
    await this.mine.descendTo(state.targetY);
    await this.mine.stripMineStep(state.miningDir, 16);
    await this.chest.depositRoutine();
  }
}
