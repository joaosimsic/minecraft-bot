import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { log } from './log';
import { findItem, pickaxeTier, sleep } from './util';

const HOSTILE = new Set(['Zombie', 'Skeleton', 'Spider', 'Creeper', 'PigZombie', 'Slime', 'CaveSpider']);

export function isHostile(e: Entity): boolean {
  if (!e || e.type !== 'mob') return false;
  const n = (e as any).mobType ?? e.name ?? '';
  return HOSTILE.has(n);
}

export function nearestHostile(bot: Bot, range = 8): Entity | null {
  let best: Entity | null = null;
  let bestD = range * range;
  for (const id in bot.entities) {
    const e = bot.entities[id]!;
    if (!isHostile(e) || !e.position) continue;
    const d = e.position.distanceSquared(bot.entity.position);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

async function equipBestWeapon(bot: Bot): Promise<void> {
  const swords = bot.inventory.items().filter((i) => i.name.includes('sword'));
  const sword = swords.sort((a, b) => pickaxeTier(b.name) - pickaxeTier(a.name))[0];
  if (sword) {
    try {
      await bot.equip(sword, 'hand');
      return;
    } catch {}
  }
  const pick = findItem(bot, (n) => n.includes('pickaxe'));
  if (pick) {
    try {
      await bot.equip(pick, 'hand');
    } catch {}
  }
}

export async function fightNearby(bot: Bot, range = 6): Promise<boolean> {
  const target = nearestHostile(bot, range);
  if (!target) return false;
  log('combat: engaging', (target as any).mobType ?? target.name);
  await equipBestWeapon(bot);
  const start = Date.now();
  while (target.isValid && Date.now() - start < 15000) {
    const d = target.position.distanceTo(bot.entity.position);
    if (d > 4) {
      try {
        await bot.lookAt(target.position.offset(0, 1, 0));
        bot.setControlState('forward', true);
        await sleep(200);
        bot.setControlState('forward', false);
      } catch {}
    } else {
      await bot.lookAt(target.position.offset(0, 1, 0));
      bot.attack(target);
      await sleep(600);
    }
  }
  bot.setControlState('forward', false);
  return true;
}
