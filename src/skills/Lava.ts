import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import { Utils } from '../shared/Utils';
import { wrap } from '../shared/result';
import { LAVA_NAMES, FILLER_BLOCKS } from '../shared/constants';

const INVALID_REF = new Set([
  'air',
  'lava',
  'water',
  'flowing_lava',
  'still_lava',
  'flowing_water',
  'still_water',
]);

const FACES: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(0, -1, 0),
  new Vec3(0, 1, 0),
];

export class Lava {
  private readonly log = new Logger('Lava');

  constructor(private readonly bot: Bot) {}

  public async sealNearby(radius = 4): Promise<boolean> {
    const lava = this.bot.findBlock({
      matching: (b) => b !== null && LAVA_NAMES.has(b.name),
      maxDistance: radius,
    });

    if (!lava) return false;

    const filler = Utils.findItem(
      this.bot,
      (n) =>
        FILLER_BLOCKS.has(n),
    );

    if (!filler) {
      this.log.warn('no filler block');
      return false;
    }

    this.log.info('sealing at', lava.position);

    const [eqErr] = await wrap(this.bot.equip(filler, 'hand'));
    if (eqErr) {
      this.log.warn('equip failed', eqErr.message);
      return false;
    }

    for (const face of FACES) {
      const ref = this.bot.blockAt(lava.position.minus(face));

      if (!ref || INVALID_REF.has(ref.name)) continue;

      const [lookErr] = await wrap(
        this.bot.lookAt(lava.position.offset(0.5, 0.5, 0.5)),
      );
      if (lookErr) {
        this.log.warn('place failed', lookErr.message);
        continue;
      }

      const [plErr] = await wrap(this.bot.placeBlock(ref, face));
      if (plErr) {
        this.log.warn('place failed', plErr.message);
        continue;
      }

      await Utils.sleep(300);
      return true;
    }

    return false;
  }
}
