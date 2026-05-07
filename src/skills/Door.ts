import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import { wrap } from '../shared/result';
import { metrics } from '../shared/Metrics';

interface BlockWithProps extends Block {
  properties?: Record<string, string | boolean>;
}

type SkipReason =
  | 'not_in_front'
  | 'no_block'
  | 'not_door'
  | 'recently_toggled'
  | 'upper_half'
  | 'already_open'
  | 'activate_failed';

export class Door {
  private readonly log = new Logger('Door');
  private readonly recentlyToggled = new Set<string>();

  public constructor(private readonly bot: Bot) {}

  public isDoor(name: string): boolean {
    return /door/i.test(name);
  }

  public async openDoorAt(pos: Vec3): Promise<boolean> {
    const block = this.bot.blockAt(pos) as BlockWithProps | null;
    const blockName = block?.name ?? null;
    const props = block?.properties ?? {};
    const key = `${pos.x},${pos.y},${pos.z}`;

    const inFront = this.isDirectlyInFrontDetailed(pos);

    if (!inFront.ok) {
      if (block && this.isDoor(block.name)) {
        this.logSkip('not_in_front', pos, blockName, props, inFront);
      }
      return false;
    }

    if (!block) {
      this.logSkip('no_block', pos, blockName, props, inFront);
      return false;
    }

    if (!this.isDoor(block.name)) {
      this.logSkip('not_door', pos, blockName, props, inFront);
      return false;
    }

    if (this.recentlyToggled.has(key)) {
      this.logSkip('recently_toggled', pos, blockName, props, inFront);
      return true;
    }

    if (props.half === 'upper') {
      this.logSkip('upper_half', pos, blockName, props, inFront);
      return false;
    }

    if (props.open === 'true' || props.open === true) {
      this.logSkip('already_open', pos, blockName, props, inFront);
      return true;
    }

    this.recentlyToggled.add(key);
    setTimeout(() => this.recentlyToggled.delete(key), 1500);

    this.log.event('door_activate', {
      x: pos.x, y: pos.y, z: pos.z, name: blockName, props, ...inFront,
    });

    const [err] = await wrap(this.bot.activateBlock(block));
    if (err) {
      this.log.error('open fail', err.message);
      this.log.event('door_skip', {
        reason: 'activate_failed' satisfies SkipReason,
        x: pos.x, y: pos.y, z: pos.z, name: blockName, msg: err.message,
      });
      this.recentlyToggled.delete(key);
      return false;
    }

    await new Promise<void>((r) => setTimeout(r, 250));

    metrics.inc('door.open');
    this.log.info('opened at', `(${pos.x}, ${pos.y}, ${pos.z})`);
    this.log.decision('door_open', 'in_front_and_closed', { x: pos.x, y: pos.y, z: pos.z, name: blockName });
    this.log.event('door_open', { x: pos.x, y: pos.y, z: pos.z, name: blockName });
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

    const targets: Vec3[] = [
      front, front.offset(0, 1, 0),
      left,  left.offset(0, 1, 0),
      right, right.offset(0, 1, 0),
    ];

    const scan = targets.map((t): Record<string, unknown> => {
      const b = this.bot.blockAt(t) as BlockWithProps | null;
      return {
        x: t.x, y: t.y, z: t.z,
        name: b?.name ?? null,
        props: b?.properties ?? null,
        isDoor: b ? this.isDoor(b.name) : false,
      };
    });

    this.log.event('door_scan', {
      botPos: { x: +this.bot.entity.position.x.toFixed(2), y: +this.bot.entity.position.y.toFixed(2), z: +this.bot.entity.position.z.toFixed(2) },
      yaw: +yaw.toFixed(3), dx, dz,
      checks: scan,
    });

    await Promise.all(targets.map((t): Promise<boolean> => this.openDoorAt(t)));
  }

  private logSkip(
    reason: SkipReason,
    pos: Vec3,
    name: string | null,
    props: Record<string, string | boolean>,
    inFront: { ok: boolean; dist: number; dot: number },
  ): void {
    metrics.inc(`door.skip.${reason}`);
    this.log.event('door_skip', {
      reason, x: pos.x, y: pos.y, z: pos.z,
      name, props, dist: inFront.dist, dot: inFront.dot,
    });
  }

  private isDirectlyInFrontDetailed(doorPos: Vec3): { ok: boolean; dist: number; dot: number } {
    const botPos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;

    const lookX = -Math.sin(yaw);
    const lookZ = -Math.cos(yaw);

    const toDoorX = doorPos.x + 0.5 - botPos.x;
    const toDoorZ = doorPos.z + 0.5 - botPos.z;

    const dist = Math.sqrt(toDoorX * toDoorX + toDoorZ * toDoorZ);

    if (dist < 0.5) return { ok: true, dist: +dist.toFixed(3), dot: 1 };

    const nToDoorX = toDoorX / dist;
    const nToDoorZ = toDoorZ / dist;

    const dot = lookX * nToDoorX + lookZ * nToDoorZ;
    const ok = dot > 0.85 && dist < 2.5;

    return { ok, dist: +dist.toFixed(3), dot: +dot.toFixed(3) };
  }

  private async closeDoorWhenClear(block: Block, pos: Vec3): Promise<void> {
    const start = Date.now();

    let hasSteppedInside = false;

    while (Date.now() - start < 25000) {
      const dist = this.bot.entity.position.distanceTo(pos.offset(0.5, 0, 0.5));

      if (!hasSteppedInside && dist < 1.0) hasSteppedInside = true;

      if (hasSteppedInside && dist > 1.5) {
        await new Promise<void>((r) => setTimeout(r, 300));

        const [clErr] = await wrap(this.bot.activateBlock(block));
        if (clErr) this.log.error('close fail', clErr.message);
        if (!clErr) {
          metrics.inc('door.close');
          this.log.info('closed at', `(${pos.x}, ${pos.y}, ${pos.z})`);
          this.log.event('door_close', { x: pos.x, y: pos.y, z: pos.z });
        }

        return;
      }

      await new Promise<void>((r) => setTimeout(r, 200));
    }

    this.log.event('door_close_timeout', { x: pos.x, y: pos.y, z: pos.z, hasSteppedInside });
  }
}
