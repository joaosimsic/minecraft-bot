import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import { Utils } from '../shared/Utils';
import { Lava } from './Lava';
import { Combat } from './Combat';
import { Lighting } from './Lighting';
import { Door } from './Door';
import { wrap } from '../shared/result';
import type { Metrics } from '../shared/Metrics';
import type { Navigator } from './Navigator';
import { LAVA_NAMES, FILLER_BLOCKS } from '../shared/constants';

const UNBREAKABLE = new Set([
  'bedrock',
  'water',
  'flowing_water',
  'still_water',
]);
const AIR_OR_LAVA = new Set(['air', 'lava', 'flowing_lava', 'still_lava']);

export class Mine {
  private readonly log: Logger;
  private readonly bot: Bot;
  private readonly navigator: Navigator;
  private readonly lava: Lava;
  private readonly combat: Combat;
  private readonly lighting: Lighting;
  private readonly door: Door;
  private readonly metrics: Metrics;

  public constructor(
    bot: Bot,
    navigator: Navigator,
    botId: string,
    metrics: Metrics,
  ) {
    this.bot = bot;
    this.navigator = navigator;
    this.metrics = metrics;
    this.log = new Logger('Mine', botId);
    this.lava = new Lava(bot, botId);
    this.combat = new Combat(bot, botId);
    this.lighting = new Lighting(bot, botId);
    this.door = new Door(bot, botId, metrics);
  }

  public async descendTo(targetY: number): Promise<void> {
    if (Math.floor(this.bot.entity.position.y) <= targetY + 1) return;

    const { x, z } = this.bot.entity.position;
    const gx = Math.floor(x) + 0.5;
    const gz = Math.floor(z) + 0.5;
    const gy = Math.floor(targetY) + 0.5;
    const goal = new Vec3(gx, gy, gz);

    this.log.info('descendTo: navigating toward Y', targetY);

    const pathPromise = this.navigator
      .walkTo(goal, 10)
      .then((okWalk): boolean => {
        if (!okWalk) return false;
        return Math.floor(this.bot.entity.position.y) <= targetY + 2;
      });

    const [wErr, reachedVal] = await Utils.withTimeout(
      pathPromise,
      30000,
      'descendTo',
    );

    if (wErr !== null)
      this.log.warn('navigation descend failed, digging down', wErr.message);

    const reached = wErr === null && reachedVal === true;
    if (reached) return;

    await this.digDown(targetY);
  }

  public async stripMineStep(dir: Vec3, length: number): Promise<void> {
    for (let i = 0; i < length; i++) {
      await this.combat.fightNearby(6);
      await this.lava.sealNearby(4);

      const cur = this.bot.entity.position.floored();
      const ahead = new Vec3(cur.x + dir.x, cur.y + dir.y, cur.z + dir.z);
      const aheadDown = new Vec3(ahead.x, ahead.y - 1, ahead.z);

      await this.digIfNeeded(ahead.offset(0, 1, 0));
      await this.digIfNeeded(ahead);
      await this.fillFloorIfNeeded(aheadDown);
      await this.moveTo(ahead.offset(0.5, 0, 0.5));

      if (i % 8 === 0) await this.lighting.placeTorchNear();
    }
  }

  private async digDown(targetY: number): Promise<void> {
    while (Math.floor(this.bot.entity.position.y) > targetY + 1) {
      const cur = this.bot.entity.position.floored();

      await this.lava.sealNearby(3);
      await this.digIfNeeded(new Vec3(cur.x, cur.y - 1, cur.z));
      await Utils.sleep(300);
      if (this.bot.entity.position.y === cur.y) return;
    }
  }

  private async digIfNeeded(pos: Vec3): Promise<void> {
    const b = this.bot.blockAt(pos);
    if (!b || b.name === 'air' || UNBREAKABLE.has(b.name)) return;

    if (this.door.isDoor(b.name)) {
      await this.door.openDoorAt(pos);
      return;
    }

    if (LAVA_NAMES.has(b.name)) {
      await this.lava.sealNearby(3);
      return;
    }

    if (!this.bot.canDigBlock(b)) return;

    const [digErr] = await wrap(this.bot.dig(b));
    if (digErr) {
      this.log.warn('dig fail', b.name, digErr.message);
      return;
    }
    this.metrics.inc('blocks.dug');
  }

  private async moveTo(pos: Vec3): Promise<boolean> {
    const pathPromise = this.navigator.walkTo(pos, 1);
    const [wErr, ok] = await Utils.withTimeout(
      pathPromise,
      8000,
      'stripMine_moveTo',
    );
    if (wErr !== null) this.log.warn('moveTo failed', wErr.message);
    return wErr === null && ok === true;
  }

  private async fillFloorIfNeeded(aheadDown: Vec3): Promise<void> {
    const floor = this.bot.blockAt(aheadDown);
    if (floor && !AIR_OR_LAVA.has(floor.name)) return;

    const cobble = Utils.findItem(this.bot, (n) => FILLER_BLOCKS.has(n));
    if (!cobble) return;

    const ref = this.bot.blockAt(aheadDown.offset(0, -1, 0));
    if (!ref || ref.name === 'air') return;

    const [eqErr] = await wrap(this.bot.equip(cobble, 'hand'));
    if (eqErr) {
      this.log.warn('fill floor failed', eqErr.message);
      return;
    }

    const [plErr] = await wrap(this.bot.placeBlock(ref, new Vec3(0, 1, 0)));
    if (plErr) this.log.warn('fill floor failed', plErr.message);
  }
}
