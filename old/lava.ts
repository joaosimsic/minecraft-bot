import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { log } from './log';
import { findItem, sleep } from './util';

const FACES: Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(0, -1, 0),
  new Vec3(0, 1, 0),
];

export async function sealNearbyLava(bot: Bot, radius = 4): Promise<boolean> {
  const lava = bot.findBlock({
    matching: (b) => b !== null && (b.name === 'lava' || b.name === 'flowing_lava' || b.name === 'still_lava'),
    maxDistance: radius,
  });
  if (!lava) return false;

  const filler = findItem(bot, (n) => n === 'cobblestone' || n === 'dirt' || n === 'stone' || n === 'gravel');
  if (!filler) {
    log('lava: no filler block');
    return false;
  }
  log('lava: sealing at', lava.position);

  try {
    await bot.equip(filler, 'hand');
  } catch {
    return false;
  }

  for (const face of FACES) {
    const refPos = lava.position.minus(face);
    const ref = bot.blockAt(refPos);
    if (!ref || ref.name === 'air' || ref.name === 'lava' || ref.name === 'water') continue;
    try {
      await bot.lookAt(lava.position.offset(0.5, 0.5, 0.5));
      await bot.placeBlock(ref, face);
      await sleep(300);
      return true;
    } catch (e: any) {
      log('lava: place failed', e?.message);
    }
  }
  return false;
}
