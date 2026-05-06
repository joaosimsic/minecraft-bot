import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { Logger } from './Logger';
import { Utils } from './Utils';

type Want = { name: string; count: number };

const KEEP_LIMITS: Record<string, number> = {
  torch: 16,
  cobblestone: 64,
  stick: 8,
  coal: 8,
  crafting_table: 1,
  workbench: 1,
  chest: 1,
  planks: 8,
  oak_planks: 8,
  log: 4,
  oak_log: 4,
};

export class Chest {
  private readonly log = new Logger('Chest');

  constructor(private readonly bot: Bot) {}

  public findChest(range = 24): Block | null {
    return this.bot.findBlock({
      matching: (b) => b !== null && b.name === 'chest',
      maxDistance: range,
    });
  }

  public async placeChestNear(pos: Vec3): Promise<Block | null> {
    const chestItem = Utils.findItem(this.bot, (n) => n === 'chest');
    if (!chestItem) {
      this.log.warn('missing chest item, cannot place');
      return null;
    }

    const ground = this.bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z));
    if (!ground || ground.name === 'air') return null;

    return this.bot
      .equip(chestItem, 'hand')
      .then(() => this.bot.placeBlock(ground, new Vec3(0, 1, 0)))
      .then(() => Utils.sleep(300))
      .then(() => this.findChest(4))
      .catch((e: Error) => {
        this.log.warn('place fail', e.message);
        return null;
      });
  }

  public async depositAll(chestBlock: Block): Promise<void> {
    const chest = await this.bot.openChest(chestBlock);

    for (const it of this.bot.inventory.items()) {
      const give = it.count - Chest.shouldKeep(it.name, it.count);
      if (give <= 0) continue;

      await chest
        .deposit(it.type, it.metadata, give)
        .then(() => this.log.info('deposit', give, it.name))
        .catch((e: Error) => this.log.warn('deposit fail', it.name, e.message));
    }

    chest.close();
  }

  public async withdrawIfHas(chestBlock: Block, want: Want[]): Promise<void> {
    const chest = await this.bot.openChest(chestBlock);

    for (const w of want) {
      const slot = chest.containerItems().find((i) => i.name === w.name);
      if (!slot) continue;

      const take = Math.min(slot.count, w.count);
      await chest
        .withdraw(slot.type, slot.metadata, take)
        .then(() => this.log.info('withdrew', take, w.name))
        .catch((e: Error) => this.log.warn('withdraw fail', w.name, e.message));
    }

    chest.close();
  }

  public async depositRoutine(): Promise<boolean> {
    const { x, y, z } = this.bot.entity.position;
    const chest =
      this.findChest(32) ??
      (await this.placeChestNear(new Vec3(x, y, z)));
    if (!chest) return false;

    await this.depositAll(chest);
    return true;
  }

  private static shouldKeep(name: string, count: number): number {
    if (
      name.includes('pickaxe') ||
      name.includes('sword') ||
      name.includes('axe')
    )
      return count;
    return Math.min(KEEP_LIMITS[name] ?? 0, count);
  }
}

