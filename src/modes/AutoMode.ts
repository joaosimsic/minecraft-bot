import type { BotMode } from './BotMode';
import type { Mine } from '../skills/Mine';
import type { Craft } from '../skills/Craft';
import type { Chest } from '../skills/Chest';
import type { BotRuntimeContext } from '../core/BotRuntimeContext';

export class AutoMode implements BotMode {
  public constructor(
    private readonly mine: Mine,
    private readonly craft: Craft,
    private readonly chest: Chest,
    private readonly runtime: BotRuntimeContext,
  ) {}

  public async tick(): Promise<void> {
    await this.craft.ensureTools();
    await this.craft.craftTorches();

    await this.mine.descendTo(this.runtime.targetY);

    await this.mine.stripMineStep(this.runtime.miningDir, 16);

    await this.chest.depositRoutine();
  }
}
