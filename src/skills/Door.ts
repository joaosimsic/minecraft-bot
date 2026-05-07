import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import { wrap } from '../shared/result';

interface BlockWithProps extends Block {
  properties?: Record<string, string | boolean>;
}

export class Door {
  private readonly log = new Logger('Door');
  private readonly recentlyToggled = new Set<string>();

  public constructor(private readonly bot: Bot) {}

  public isDoor(name: string): boolean {
    return /door/i.test(name);
  }

  public async openDoorAt(pos: Vec3): Promise<boolean> {
    // 1. Strict Vector Guard: Abort if the door isn't directly in the forward path
    if (!this.isDirectlyInFront(pos)) return false;

    const block = this.bot.blockAt(pos) as BlockWithProps | null;

    if (!block || !this.isDoor(block.name)) return false;

    const key = `${pos.x},${pos.y},${pos.z}`;

    if (this.recentlyToggled.has(key)) return true;

    const props = block.properties ?? {};

    if (props.half === 'upper') return false;

    if (props.open === 'true' || props.open === true) return true;

    this.recentlyToggled.add(key);
    setTimeout(() => this.recentlyToggled.delete(key), 1500);

    const [err] = await wrap(this.bot.activateBlock(block));
    if (err) {
      this.log.error('open fail', err.message);
      this.recentlyToggled.delete(key);
      return false;
    }

    await new Promise<void>((r) => setTimeout(r, 250));

    this.log.info('opened at', `(${pos.x}, ${pos.y}, ${pos.z})`);
    void this.closeDoorWhenClear(block, pos);
    return true;
  }

  public async openDoorsAhead(): Promise<void> {
    const pos = this.bot.entity.position.floored();
    const yaw = this.bot.entity.yaw;

    const dx = Math.round(-Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));

    const lx = dz;
    const lz = -dx;

    const front = new Vec3(
      Math.floor(pos.x + dx),
      pos.y,
      Math.floor(pos.z + dz),
    );

    const left = new Vec3(front.x + lx, front.y, front.z + lz);
    const right = new Vec3(front.x - lx, front.y, front.z - lz);

    await Promise.all([
      this.openDoorAt(front),
      this.openDoorAt(front.offset(0, 1, 0)),
      this.openDoorAt(left),
      this.openDoorAt(left.offset(0, 1, 0)),
      this.openDoorAt(right),
      this.openDoorAt(right.offset(0, 1, 0)),
    ]);
  }

  private isDirectlyInFront(doorPos: Vec3): boolean {
    const botPos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;

    const lookX = -Math.sin(yaw);
    const lookZ = -Math.cos(yaw);

    const toDoorX = doorPos.x + 0.5 - botPos.x;
    const toDoorZ = doorPos.z + 0.5 - botPos.z;

    const dist = Math.sqrt(toDoorX * toDoorX + toDoorZ * toDoorZ);

    if (dist < 0.5) return true;

    const nToDoorX = toDoorX / dist;
    const nToDoorZ = toDoorZ / dist;

    const dotProduct = lookX * nToDoorX + lookZ * nToDoorZ;

    return dotProduct > 0.85 && dist < 2.5;
  }

  private async closeDoorWhenClear(block: Block, pos: Vec3): Promise<void> {
    const start = Date.now();

    let hasSteppedInside = false;

    while (Date.now() - start < 8000) {
      const dist = this.bot.entity.position.distanceTo(pos.offset(0.5, 0, 0.5));

      if (!hasSteppedInside && dist < 1.0) hasSteppedInside = true;

      if (hasSteppedInside && dist > 1.5) {
        await new Promise<void>((r) => setTimeout(r, 300));

        const [clErr] = await wrap(this.bot.activateBlock(block));
        if (clErr) this.log.error('close fail', clErr.message);
        if (!clErr)
          this.log.info('closed at', `(${pos.x}, ${pos.y}, ${pos.z})`);

        return;
      }

      await new Promise<void>((r) => setTimeout(r, 200));
    }
  }
}
