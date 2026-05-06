import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Movements, goals } from 'mineflayer-pathfinder';
import { log } from './log';
import { sleep } from './util';
import { sealNearbyLava } from './lava';
import { fightNearby } from './combat';
import { placeTorchNear } from './lighting';
import { state } from './state';
import { isDoor, openDoorAt, openDoorsAhead } from './door';

const UNBREAKABLE = new Set(['bedrock', 'lava', 'flowing_lava', 'still_lava', 'water', 'flowing_water', 'still_water']);

function v(p: { x: number; y: number; z: number }): Vec3 {
  return new Vec3(p.x, p.y, p.z);
}

async function digIfNeeded(bot: Bot, pos: Vec3): Promise<void> {
  const b = bot.blockAt(pos);
  if (!b || b.name === 'air' || UNBREAKABLE.has(b.name)) return;

  if (isDoor(b.name)) {
    await openDoorAt(bot, pos);
    return;
  }

  if (b.name === 'lava' || b.name === 'flowing_lava' || b.name === 'still_lava') {
    await sealNearbyLava(bot, 3);
    return;
  }

  try {
    if ((bot as any).tool?.equipForBlock) {
      await (bot as any).tool.equipForBlock(b, { requireHarvest: true });
    }
  } catch {}

  try {
    if (!bot.canDigBlock(b)) return;
    await bot.dig(b);
  } catch (e: any) {
    log('dig fail', b.name, e?.message);
  }
}

async function moveTo(bot: Bot, pos: Vec3): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const d = v(bot.entity.position).distanceTo(pos);
    if (d < 0.6) {
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      return true;
    }
    try {
      await bot.lookAt(pos.offset(0, 1.6, 0));
    } catch {}
    await openDoorsAhead(bot);
    bot.setControlState('forward', true);
    const blocked = bot.blockAt(bot.entity.position.offset(0, 0, 0));
    if (blocked && blocked.name !== 'air') bot.setControlState('jump', true);
    else bot.setControlState('jump', false);
    await sleep(200);
  }
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  return false;
}

export async function descendTo(bot: Bot, targetY: number): Promise<void> {
  const pos = bot.entity.position;
  if (Math.floor(pos.y) <= targetY + 1) return;

  // try pathfinder first — prefers existing shafts/stairs, digs only if needed
  try {
    const moves = new Movements(bot as any);
    moves.canDig = true;
    moves.allow1by1towers = false;
    (moves as any).canOpenDoors = true;
    (bot as any).pathfinder.setMovements(moves);
    log('descendTo: pathfinding to Y', targetY);
    await Promise.race([
      // radius 10 lets pathfinder route through staircases offset from current XZ
      (bot as any).pathfinder.goto(new goals.GoalNear(pos.x, targetY, pos.z, 10)),
      sleep(30000).then(() => { throw new Error('timeout'); }),
    ]);
    if (Math.floor(bot.entity.position.y) <= targetY + 2) return;
  } catch (e: any) {
    log('descendTo: pathfinder failed, digging down', e?.message);
  }

  // fallback: dig straight down
  while (Math.floor(bot.entity.position.y) > targetY + 1) {
    const cur = v(bot.entity.position).floored();
    const below = new Vec3(cur.x, cur.y - 1, cur.z);
    await sealNearbyLava(bot, 3);
    await digIfNeeded(bot, below);
    await sleep(300);
    if (bot.entity.position.y === cur.y) break;
  }
}

export async function stripMineStep(bot: Bot, dir: Vec3, length: number): Promise<void> {
  for (let i = 0; i < length; i++) {
    if (state.shouldStop) return;
    await fightNearby(bot, 6);
    await sealNearbyLava(bot, 4);

    const cur = v(bot.entity.position).floored();
    const ahead = cur.plus(dir);
    const aheadUp = ahead.offset(0, 1, 0);
    const aheadDown = ahead.offset(0, -1, 0);

    await digIfNeeded(bot, aheadUp);
    await digIfNeeded(bot, ahead);

    const floor = bot.blockAt(aheadDown);
    if (!floor || floor.name === 'air' || floor.name === 'lava') {
      const cobble = bot.inventory.items().find((it) => it.name === 'cobblestone' || it.name === 'dirt');
      if (cobble) {
        try {
          await bot.equip(cobble, 'hand');
          const ref = bot.blockAt(aheadDown.offset(0, -1, 0));
          if (ref && ref.name !== 'air') await bot.placeBlock(ref, new Vec3(0, 1, 0));
        } catch {}
      }
    }

    await moveTo(bot, ahead.offset(0.5, 0, 0.5));

    if (i % 8 === 0) {
      await placeTorchNear(bot);
    }
  }
}
