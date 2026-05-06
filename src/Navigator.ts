import type { Bot } from 'mineflayer';
import type { Pathfinder } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { Movements, goals } from 'mineflayer-pathfinder';
import { Logger } from './Logger';
import { Door } from './Door';
import { Utils } from './Utils';

type PathfinderBot = Bot & { pathfinder: Pathfinder };

export class Navigator {
  private readonly log = new Logger('Navigator');
  private readonly pbot: PathfinderBot;

  constructor(
    bot: Bot,
    private readonly door: Door,
  ) {
    this.pbot = bot as PathfinderBot;
  }

  public async walkTo(target: Vec3, timeoutMs = 60000): Promise<boolean> {
    if (this.pbot.entity.position.distanceTo(target) < 0.5) return true;

    const reached = await this.pathfindTo(target, timeoutMs);

    if (reached) return true;

    return this.manualWalkTo(target);
  }

  private async pathfindTo(target: Vec3, timeoutMs: number): Promise<boolean> {
    const moves = new Movements(this.pbot);

    moves.canDig = false;
    moves.allow1by1towers = false;
    moves.canOpenDoors = true;

    this.pbot.pathfinder.setMovements(moves);

    this.log.info('pathfinding to', `(${target.x}, ${target.y}, ${target.z})`);

    const timeout = Utils.sleep(timeoutMs).then((): never => {
      throw new Error('timeout');
    });

    return Promise.race([
      this.pbot.pathfinder
        .goto(new goals.GoalBlock(target.x, target.y, target.z))
        .then(() => true as const),
      timeout,
    ]).catch((e: Error) => {
      this.log.warn(
        e.message === 'timeout' ? 'timeout' : `pathfinder failed: ${e.message}`,
      );
      return false as const;
    });
  }

  private async manualWalkTo(target: Vec3): Promise<boolean> {
    this.log.info('manual walk to', `(${target.x}, ${target.y}, ${target.z})`);
    const start = Date.now();

    while (Date.now() - start < 15000) {
      const pos = this.pbot.entity.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;

      if (dx * dx + dz * dz < 0.25 && Math.abs(target.y - pos.y) < 1) {
        this.pbot.setControlState('forward', false);
        this.pbot.setControlState('jump', false);
        return true;
      }

      await this.pbot
        .lookAt(new Vec3(target.x, pos.y + 1.6, target.z))
        .catch((e: Error) => this.log.warn('lookAt failed', e.message));

      await this.door.openDoorsAhead();

      this.pbot.setControlState('forward', true);

      const front = this.pbot.blockAt(
        new Vec3(
          Math.floor(pos.x + Math.sign(dx) * 0.5),
          Math.floor(pos.y),
          Math.floor(pos.z + Math.sign(dz) * 0.5),
        ),
      );
      this.pbot.setControlState('jump', front !== null && front.name !== 'air');

      await Utils.sleep(250);
    }

    this.pbot.setControlState('forward', false);
    this.pbot.setControlState('jump', false);
    return false;
  }
}

