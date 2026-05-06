import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { Logger } from '../shared/Logger';
import { Utils } from '../shared/Utils';
import { wrap } from '../shared/result';

interface MobEntity extends Entity {
  mobType?: string;
}

const HOSTILE = new Set([
  'Zombie',
  'Skeleton',
  'Spider',
  'Creeper',
  'PigZombie',
  'Slime',
  'CaveSpider',
]);

export class Combat {
  private readonly log = new Logger('Combat');

  constructor(private readonly bot: Bot) {}

  public isHostile(e: Entity): boolean {
    if (!e || e.type !== 'mob') return false;
    return HOSTILE.has((e as MobEntity).mobType ?? e.name ?? '');
  }

  public nearestHostile(range = 8): Entity | null {
    let best: Entity | null = null;
    let bestD = range * range;

    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];

      if (!e || !this.isHostile(e) || !e.position) continue;

      const d = e.position.distanceSquared(this.bot.entity.position);
      if (d >= bestD) continue;

      best = e;
      bestD = d;
    }

    return best;
  }

  public async fightNearby(range = 6): Promise<boolean> {
    const target = this.nearestHostile(range);
    if (!target) return false;

    this.log.info(
      'engaging',
      (target as MobEntity).mobType ?? target.name ?? 'unknown',
    );
    await this.equipBestWeapon();

    const start = Date.now();

    while (target.isValid && Date.now() - start < 15000) {
      const d = target.position.distanceTo(this.bot.entity.position);

      if (d > 4) {
        const [lookErr] = await wrap(
          this.bot.lookAt(target.position.offset(0, 1, 0)),
        );
        if (lookErr) this.log.warn('lookAt failed', lookErr.message);

        this.bot.setControlState('forward', true);

        await Utils.sleep(200);

        this.bot.setControlState('forward', false);

        continue;
      }

      const [lookErr2] = await wrap(
        this.bot.lookAt(target.position.offset(0, 1, 0)),
      );
      if (lookErr2) this.log.warn('lookAt failed', lookErr2.message);

      this.bot.attack(target);

      await Utils.sleep(600);
    }

    this.bot.setControlState('forward', false);
    return true;
  }

  private async equipBestWeapon(): Promise<void> {
    const sword =
      this.bot.inventory
        .items()
        .filter((i) => i.name.includes('sword'))
        .sort(
          (a, b) => Utils.pickaxeTier(b.name) - Utils.pickaxeTier(a.name),
        )[0] ?? Utils.findItem(this.bot, (n) => n.includes('pickaxe'));

    if (!sword) return;

    const [eqErr] = await wrap(this.bot.equip(sword, 'hand'));
    if (eqErr) this.log.warn('equip failed', eqErr.message);
  }
}
