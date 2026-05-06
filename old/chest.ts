import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { log } from './log';
import { findItem, sleep } from './util';

export function findChest(bot: Bot, range = 24): Block | null {
  return bot.findBlock({
    matching: (b) => b !== null && b.name === 'chest',
    maxDistance: range,
  });
}

export async function placeChestNear(bot: Bot, pos: { x: number; y: number; z: number }): Promise<Block | null> {
  let chestItem = findItem(bot, (n) => n === 'chest');
  if (!chestItem) {
    log('chest: missing chest item, cannot place');
    return null;
  }
  const ground = bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z));
  if (!ground || ground.name === 'air') return null;
  try {
    await bot.equip(chestItem, 'hand');
    await bot.placeBlock(ground, new Vec3(0, 1, 0));
    await sleep(300);
    return findChest(bot, 4);
  } catch (e: any) {
    log('chest: place fail', e?.message);
    return null;
  }
}

function shouldKeep(name: string, count: number): number {
  if (name.includes('pickaxe') || name.includes('sword') || name.includes('axe')) return count;
  if (name === 'torch') return Math.min(16, count);
  if (name === 'cobblestone') return Math.min(64, count);
  if (name === 'stick') return Math.min(8, count);
  if (name === 'coal') return Math.min(8, count);
  if (name === 'crafting_table' || name === 'workbench') return Math.min(1, count);
  if (name === 'chest') return Math.min(1, count);
  if (name === 'planks' || name === 'oak_planks') return Math.min(8, count);
  if (name === 'log' || name === 'oak_log') return Math.min(4, count);
  return 0;
}

export async function depositAll(bot: Bot, chestBlock: Block): Promise<void> {
  const chest = await bot.openChest(chestBlock);
  try {
    for (const it of bot.inventory.items()) {
      const keep = shouldKeep(it.name, it.count);
      const give = it.count - keep;
      if (give <= 0) continue;
      try {
        await chest.deposit(it.type, (it as any).metadata ?? null, give);
        log('chest: deposit', give, it.name);
      } catch (e: any) {
        log('chest: deposit fail', it.name, e?.message);
      }
    }
  } finally {
    chest.close();
  }
}

export async function withdrawIfHas(bot: Bot, chestBlock: Block, want: { name: string; count: number }[]): Promise<void> {
  const chest = await bot.openChest(chestBlock);
  try {
    for (const w of want) {
      const slot = chest.containerItems().find((i) => i.name === w.name);
      if (!slot) continue;
      const take = Math.min(slot.count, w.count);
      try {
        await chest.withdraw(slot.type, (slot as any).metadata ?? null, take);
        log('chest: withdrew', take, w.name);
      } catch {}
    }
  } finally {
    chest.close();
  }
}

export async function depositRoutine(bot: Bot): Promise<boolean> {
  let chest = findChest(bot, 32);
  if (!chest) {
    log('chest: none nearby, placing');
    chest = await placeChestNear(bot, bot.entity.position);
    if (!chest) return false;
  }
  await depositAll(bot, chest);
  return true;
}
