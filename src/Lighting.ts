import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Logger } from './Logger';
import { Utils } from './Utils';

const INVALID_SURFACE = new Set(['air', 'lava', 'water']);

export class Lighting {
  private readonly log = new Logger('Lighting');

  constructor(private readonly bot: Bot) {}

  public isDarkHere(): boolean {
    const b = this.bot.blockAt(this.bot.entity.position);

    if (!b) return false;

    return b.light < 8;
  }

  public async placeTorchNear(): Promise<boolean> {
    if (Utils.countItem(this.bot, (n) => n === 'torch') < 1) return false;

    const torch = Utils.findItem(this.bot, (n) => n === 'torch');

    if (!torch) return false;

    const equipped = await this.bot
      .equip(torch, 'hand')
      .then(() => true)
      .catch((e: Error) => { this.log.warn('equip failed', e.message); return false as const; });

    if (!equipped) return false;

    for (const c of this.torchCandidates()) {
      const ref = this.bot.blockAt(c);

      if (!ref || INVALID_SURFACE.has(ref.name)) continue;

      const above = this.bot.blockAt(c.offset(0, 1, 0));

      if (!above || above.name !== 'air') continue;

      const placed = await this.bot
        .placeBlock(ref, new Vec3(0, 1, 0))
        .then(() => Utils.sleep(200))
        .then(() => {
          this.log.info('torch placed at', c.offset(0, 1, 0));
          return true as const;
        })
        .catch((e: Error) => { this.log.warn('place failed', e.message); return false as const; });

      if (placed) return true;
    }

    return false;
  }

  private static readonly OFFSETS: [number, number][] = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];

  private torchCandidates(): Vec3[] {
    const pos = this.bot.entity.position;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y) - 1;
    const z = Math.floor(pos.z);

    return Lighting.OFFSETS.map(([dx, dz]) => new Vec3(x + dx, y, z + dz));
  }
}
