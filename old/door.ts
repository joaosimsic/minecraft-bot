import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { log } from './log';

export function isDoor(name: string): boolean {
  return /door/i.test(name);
}

const recentlyToggled = new Set<string>();

export async function openDoorAt(bot: Bot, pos: Vec3): Promise<boolean> {
  const block = bot.blockAt(pos);
  if (!block || !isDoor(block.name)) return false;

  const key = `${pos.x},${pos.y},${pos.z}`;

  if (recentlyToggled.has(key)) return true;

  const props = (block as any).properties ?? {};
  if (props.half === 'upper') return false;
  if (props.open === 'true' || props.open === true) return true;

  try {
    recentlyToggled.add(key);

    setTimeout(() => recentlyToggled.delete(key), 4000);

    await bot.activateBlock(block);
    log('door opened at', `(${pos.x}, ${pos.y}, ${pos.z})`);

    closeDoorWhenClear(bot, block, pos);

    return true;
  } catch (e: any) {
    log('door open fail', e?.message);
    return false;
  }
}

export async function openDoorsAhead(bot: Bot): Promise<void> {
  const pos = bot.entity.position.floored();
  const yaw = bot.entity.yaw;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const front = new Vec3(
    Math.floor(pos.x + Math.round(dx)),
    pos.y,
    Math.floor(pos.z + Math.round(dz)),
  );
  await openDoorAt(bot, front);
  await openDoorAt(bot, front.offset(0, 1, 0));
}

async function closeDoorWhenClear(bot: Bot, block: any, pos: Vec3) {
  const start = Date.now();
  let hasSteppedInside = false;

  while (Date.now() - start < 8000) {
    const dist = bot.entity.position.distanceTo(pos.offset(0.5, 0, 0.5));

    if (!hasSteppedInside) {
      if (dist < 1.0) {
        hasSteppedInside = true;
      }
    } else {
      if (dist > 1.5) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await bot.activateBlock(block);
          log('door closed at', `(${pos.x}, ${pos.y}, ${pos.z})`);
        } catch (e: any) {
          log('door close fail', e?.message);
        }
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
