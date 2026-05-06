import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { log } from './log';
import { countItem, findItem, sleep } from './util';

export async function placeTorchNear(bot: Bot): Promise<boolean> {
  if (countItem(bot, (n) => n === 'torch') < 1) return false;

  const pos = bot.entity.position;
  const candidates: Vec3[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      candidates.push(new Vec3(Math.floor(pos.x) + dx, Math.floor(pos.y) - 1, Math.floor(pos.z) + dz));
    }
  }

  const torch = findItem(bot, (n) => n === 'torch');
  if (!torch) return false;
  try {
    await bot.equip(torch, 'hand');
  } catch {
    return false;
  }

  for (const c of candidates) {
    const ref = bot.blockAt(c);
    if (!ref || ref.name === 'air' || ref.name === 'lava' || ref.name === 'water') continue;
    const above = bot.blockAt(c.offset(0, 1, 0));
    if (!above || above.name !== 'air') continue;
    try {
      await bot.placeBlock(ref, new Vec3(0, 1, 0));
      await sleep(200);
      log('torch placed at', c.offset(0, 1, 0));
      return true;
    } catch {}
  }
  return false;
}

export function isDarkHere(bot: Bot): boolean {
  const b = bot.blockAt(bot.entity.position);
  if (!b) return false;
  const light = (b as any).light ?? (b as any).skyLight ?? 15;
  return light < 8;
}
