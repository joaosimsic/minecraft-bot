import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import { Utils } from '../shared/Utils';
import { wrap } from '../shared/result';

type Want = { name: string; count: number };

const WEAPON_TYPES = new Set(['pickaxe', 'sword', 'axe']);

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

  public constructor(private readonly bot: Bot) {}

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

    const [eqErr] = await wrap(this.bot.equip(chestItem, 'hand'));
    if (eqErr) {
      this.log.warn('place fail', eqErr.message);
      return null;
    }

    const [plErr] = await wrap(this.bot.placeBlock(ground, new Vec3(0, 1, 0)));
    if (plErr) {
      this.log.warn('place fail', plErr.message);
      return null;
    }

    await Utils.sleep(300);
    return this.findChest(4);
  }

  public async depositAll(chestBlock: Block): Promise<void> {
    const [openErr, win] = await wrap(this.bot.openChest(chestBlock));
    if (openErr) {
      this.log.warn('open chest failed', openErr.message);
      return;
    }
    if (win === null) return;

    for (const it of this.bot.inventory.items()) {
      const give = it.count - Chest.shouldKeep(it.name, it.count);
      if (give <= 0) continue;

      const [depErr] = await wrap(win.deposit(it.type, it.metadata, give));
      if (depErr)
        this.log.warn('deposit fail', it.name, depErr.message);
      if (!depErr) this.log.info('deposit', give, it.name);
    }

    win.close();
  }

  public async withdrawIfHas(chestBlock: Block, want: Want[]): Promise<void> {
    const [openErr, win] = await wrap(this.bot.openChest(chestBlock));
    if (openErr) {
      this.log.warn('open chest failed', openErr.message);
      return;
    }
    if (win === null) return;

    for (const w of want) {
      const slot = win.containerItems().find((i) => i.name === w.name);
      if (!slot) continue;

      const take = Math.min(slot.count, w.count);
      const [wErr] = await wrap(
        win.withdraw(slot.type, slot.metadata, take),
      );
      if (wErr) this.log.warn('withdraw fail', w.name, wErr.message);
      if (!wErr) this.log.info('withdrew', take, w.name);
    }

    win.close();
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
    for (const t of WEAPON_TYPES) {
      if (name.includes(t)) return count;
    }
    return Math.min(KEEP_LIMITS[name] ?? 0, count);
  }
}
