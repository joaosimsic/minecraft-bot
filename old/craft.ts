import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { log } from './log';
import { countItem, findItem, pickaxeTier, sleep } from './util';

function itemId(bot: Bot, name: string): number | null {
  const mc = (bot as any).registry ?? require('minecraft-data')(bot.version);
  const it = mc.itemsByName[name];
  return it ? it.id : null;
}

export function findCraftingTable(bot: Bot, range = 16): Block | null {
  return bot.findBlock({
    matching: (b) => b !== null && (b.name === 'crafting_table' || b.name === 'workbench'),
    maxDistance: range,
  });
}

async function craft(bot: Bot, name: string, count: number, table: Block | null): Promise<boolean> {
  const id = itemId(bot, name);
  if (id == null) {
    log('craft: unknown item', name);
    return false;
  }
  const recipes = bot.recipesFor(id, null, count, table as any);
  if (!recipes.length) {
    log('craft: no recipe for', name, table ? '(table)' : '(2x2)');
    return false;
  }
  try {
    await bot.craft(recipes[0]!, count, table as any);
    log('craft: made', count, name);
    return true;
  } catch (e: any) {
    log('craft: failed', name, e?.message);
    return false;
  }
}

export async function ensurePlanks(bot: Bot, want: number): Promise<boolean> {
  const have = countItem(bot, (n) => n === 'planks' || n === 'wood' || n === 'oak_planks');
  if (have >= want) return true;
  const need = Math.ceil((want - have) / 4);
  const log_ = findItem(bot, (n) => n === 'log' || n === 'wood' || n.endsWith('_log'));
  if (!log_) return false;
  for (let i = 0; i < need && i < log_.count; i++) {
    await craft(bot, 'planks', 1, null);
  }
  return countItem(bot, (n) => n === 'planks' || n === 'oak_planks') >= want;
}

export async function ensureSticks(bot: Bot, want: number): Promise<boolean> {
  if (countItem(bot, (n) => n === 'stick') >= want) return true;
  await ensurePlanks(bot, 2);
  await craft(bot, 'stick', Math.ceil(want / 4), null);
  return countItem(bot, (n) => n === 'stick') >= want;
}

export async function ensureCraftingTable(bot: Bot): Promise<Block | null> {
  let table = findCraftingTable(bot, 8);
  if (table) return table;

  let have = findItem(bot, (n) => n === 'crafting_table' || n === 'workbench');
  if (!have) {
    await ensurePlanks(bot, 4);
    await craft(bot, 'crafting_table', 1, null);
    have = findItem(bot, (n) => n === 'crafting_table' || n === 'workbench');
  }
  if (!have) return null;

  await bot.equip(have, 'hand');
  const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (!ref) return null;
  try {
    await bot.placeBlock(ref, new Vec3(0, 1, 0));
    await sleep(300);
  } catch (e: any) {
    log('table: place failed', e?.message);
  }
  return findCraftingTable(bot, 4);
}

export async function craftPickaxe(bot: Bot): Promise<boolean> {
  const have = bot.inventory.items().find((i) => i.name.includes('pickaxe'));
  if (have) return true;

  const table = await ensureCraftingTable(bot);
  if (!table) return false;
  await ensureSticks(bot, 2);

  const cobble = countItem(bot, (n) => n === 'cobblestone');
  if (cobble >= 3) {
    await ensurePlanks(bot, 0);
    if (await craft(bot, 'stone_pickaxe', 1, table)) return true;
  }
  await ensurePlanks(bot, 3);
  return await craft(bot, 'wooden_pickaxe', 1, table);
}

export async function craftSword(bot: Bot): Promise<boolean> {
  const have = bot.inventory.items().find((i) => i.name.includes('sword'));
  if (have) return true;
  const table = await ensureCraftingTable(bot);
  if (!table) return false;
  await ensureSticks(bot, 1);
  if (countItem(bot, (n) => n === 'cobblestone') >= 2) {
    if (await craft(bot, 'stone_sword', 1, table)) return true;
  }
  await ensurePlanks(bot, 2);
  return await craft(bot, 'wooden_sword', 1, table);
}

export async function craftTorches(bot: Bot, want = 16): Promise<boolean> {
  if (countItem(bot, (n) => n === 'torch') >= want) return true;
  if (countItem(bot, (n) => n === 'coal') < 1) {
    log('torches: no coal');
    return false;
  }
  await ensureSticks(bot, 1);
  return await craft(bot, 'torch', Math.min(want, 16), null);
}

export async function ensureTools(bot: Bot): Promise<void> {
  const pick = bot.inventory.items().find((i) => i.name.includes('pickaxe'));
  if (!pick || pickaxeTier(pick.name) < 1) await craftPickaxe(bot);
  if (!bot.inventory.items().find((i) => i.name.includes('sword'))) await craftSword(bot);
}
