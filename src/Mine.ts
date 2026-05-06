import type { Bot } from 'mineflayer';
import type { Pathfinder } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { Movements, goals } from 'mineflayer-pathfinder';
import { Logger } from './Logger';
import { Utils } from './Utils';
import { Lava } from './Lava';
import { Combat } from './Combat';
import { Lighting } from './Lighting';
import { Door } from './Door';
import { wrap } from './result';
import { LAVA_NAMES, FILLER_BLOCKS } from './constants';

const UNBREAKABLE = new Set([
  'bedrock',
  'water',
  'flowing_water',
  'still_water',
]);
const AIR_OR_LAVA = new Set(['air', 'lava', 'flowing_lava', 'still_lava']);

type PathfinderBot = Bot & { pathfinder: Pathfinder };

export class Mine {
  private readonly log = new Logger('Mine');
  private readonly pbot: PathfinderBot;
  private readonly lava: Lava;
  private readonly combat: Combat;
  private readonly lighting: Lighting;
  private readonly door: Door;

  public constructor(bot: Bot) {
    this.pbot = bot as PathfinderBot;
    this.lava = new Lava(bot);
    this.combat = new Combat(bot);
    this.lighting = new Lighting(bot);
    this.door = new Door(bot);
  }

  public async descendTo(targetY: number): Promise<void> {
    if (Math.floor(this.pbot.entity.position.y) <= targetY + 1) return;

    const { x, z } = this.pbot.entity.position;
    const moves = new Movements(this.pbot);
    moves.canDig = true;
    moves.allow1by1towers = false;
    moves.canOpenDoors = true;
    this.pbot.pathfinder.setMovements(moves);

    this.log.info('descendTo: pathfinding to Y', targetY);

    const [wErr, reachedVal] = await Utils.withTimeout(
      this.pbot.pathfinder
        .goto(new goals.GoalNear(x, targetY, z, 10))
        .then((): boolean => Math.floor(this.pbot.entity.position.y) <= targetY + 2),
      30000,
      'descendTo',
    );

    if (wErr) this.log.warn('pathfinder failed, digging down', wErr.message);

    const reached = !wErr && reachedVal === true;
    if (reached) return;

    await this.digDown(targetY);
  }

  public async stripMineStep(dir: Vec3, length: number): Promise<void> {
    for (let i = 0; i < length; i++) {
      await this.combat.fightNearby(6);
      await this.lava.sealNearby(4);

      const cur = this.pbot.entity.position.floored();
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
    while (Math.floor(this.pbot.entity.position.y) > targetY + 1) {
      const cur = this.pbot.entity.position.floored();
      await this.lava.sealNearby(3);
      await this.digIfNeeded(new Vec3(cur.x, cur.y - 1, cur.z));
      await Utils.sleep(300);
      if (this.pbot.entity.position.y === cur.y) return;
    }
  }

  private async digIfNeeded(pos: Vec3): Promise<void> {
    const b = this.pbot.blockAt(pos);
    if (!b || b.name === 'air' || UNBREAKABLE.has(b.name)) return;

    if (this.door.isDoor(b.name)) {
      await this.door.openDoorAt(pos);
      return;
    }

    if (LAVA_NAMES.has(b.name)) {
      await this.lava.sealNearby(3);
      return;
    }

    if (!this.pbot.canDigBlock(b)) return;

    const [digErr] = await wrap(this.pbot.dig(b));
    if (digErr) this.log.warn('dig fail', b.name, digErr.message);
  }

  private async moveTo(pos: Vec3): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < 8000) {
      const d = this.pbot.entity.position.distanceTo(pos);
      if (d < 0.6) {
        this.pbot.setControlState('forward', false);
        this.pbot.setControlState('jump', false);
        return true;
      }

      const [lookErr] = await wrap(this.pbot.lookAt(pos.offset(0, 1.6, 0)));
      if (lookErr) this.log.warn('lookAt failed', lookErr.message);

      await this.door.openDoorsAhead();
      this.pbot.setControlState('forward', true);

      const blocked = this.pbot.blockAt(this.pbot.entity.position);
      this.pbot.setControlState(
        'jump',
        blocked !== null && blocked.name !== 'air',
      );

      await Utils.sleep(200);
    }

    this.pbot.setControlState('forward', false);
    this.pbot.setControlState('jump', false);
    return false;
  }

  private async fillFloorIfNeeded(aheadDown: Vec3): Promise<void> {
    const floor = this.pbot.blockAt(aheadDown);
    if (floor && !AIR_OR_LAVA.has(floor.name)) return;

    const cobble = Utils.findItem(
      this.pbot,
      (n) => FILLER_BLOCKS.has(n),
    );
    if (!cobble) return;

    const ref = this.pbot.blockAt(aheadDown.offset(0, -1, 0));
    if (!ref || ref.name === 'air') return;

    const [eqErr] = await wrap(this.pbot.equip(cobble, 'hand'));
    if (eqErr) {
      this.log.warn('fill floor failed', eqErr.message);
      return;
    }

    const [plErr] = await wrap(this.pbot.placeBlock(ref, new Vec3(0, 1, 0)));
    if (plErr) this.log.warn('fill floor failed', plErr.message);
  }
}
