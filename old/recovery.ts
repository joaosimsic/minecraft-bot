import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Movements, goals } from 'mineflayer-pathfinder';
import { log } from './log';
import { sleep } from './util';
import { openDoorsAhead } from './door';

export async function walkTo(
  bot: Bot,
  target: Vec3,
  timeoutMs = 60000,
): Promise<boolean> {
  const here = bot.entity.position;
  const d = here.distanceTo(target);
  if (d < 0.5) return true;

  try {
    const moves = new Movements(bot as any);
    moves.canDig = false;
    moves.allow1by1towers = false;
    (moves as any).canOpenDoors = true;
    (bot as any).pathfinder.setMovements(moves);

    log('walkTo: pathfinding to', `(${target.x}, ${target.y}, ${target.z})`);
    await Promise.race([
      (bot as any).pathfinder.goto(
        new goals.GoalBlock(target.x, target.y, target.z),
      ),
      sleep(timeoutMs).then(() => {
        throw new Error('timeout');
      }),
    ]);
    return true;
  } catch (e: any) {
    if (e?.message !== 'timeout') {
      log('walkTo: pathfinder failed, falling back to manual walk', e?.message);
    } else {
      log('walkTo: timeout');
    }
  }

  const start = Date.now();
  while (Date.now() - start < 15000) {
    const pos = bot.entity.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    if (dx * dx + dz * dz < 0.5 * 0.5 && Math.abs(target.y - pos.y) < 1) {
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      return true;
    }
    try {
      await bot.lookAt(new Vec3(target.x, pos.y + 1.6, target.z));
    } catch {}
    await openDoorsAhead(bot);
    bot.setControlState('forward', true);
    const front = bot.blockAt(
      new Vec3(
        Math.floor(pos.x + Math.sign(dx) * 0.5),
        Math.floor(pos.y),
        Math.floor(pos.z + Math.sign(dz) * 0.5),
      ),
    );
    bot.setControlState('jump', !!(front && front.name !== 'air'));
    await sleep(250);
  }
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  return false;
}
