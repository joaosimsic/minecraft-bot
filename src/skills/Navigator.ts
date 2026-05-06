import type { Bot } from 'mineflayer';
import type { Pathfinder } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { Movements, goals } from 'mineflayer-pathfinder';
import { Logger } from '../shared/Logger';
import { Door } from './Door';
import { Utils } from '../shared/Utils';
import { wrap } from '../shared/result';

type PathfinderBot = Bot & { pathfinder: Pathfinder };
type StepResult = 'reached' | 'timeout' | 'nopath';

const MAX_ATTEMPTS = 3;

export class Navigator {
  private readonly log = new Logger('Navigator');
  private readonly pbot: PathfinderBot;

  constructor(
    bot: Bot,
    private readonly door: Door,
  ) {
    this.pbot = bot as PathfinderBot;
  }

  public async walkTo(target: Vec3, range = 1): Promise<boolean> {
    if (this.pbot.entity.position.distanceTo(target) < range) return true;

    const moves = this.buildMovements();

    if (!this.isGoalReachable(target, moves)) {
      this.log.warn('goal is unreachable, skipping pathfinding');
      return false;
    }

    const reached = await this.iterativePathfind(target, range);

    if (reached) return true;

    return this.manualWalkTo(target);
  }

  private buildMovements(): Movements {
    const moves = new Movements(this.pbot);

    moves.canDig = false;
    moves.allow1by1towers = false;
    moves.canOpenDoors = true;

    this.pbot.pathfinder.setMovements(moves);

    return moves;
  }

  private isGoalReachable(target: Vec3, moves: Movements): boolean {
    const botPos = this.pbot.entity.position;
    const targetGoal = new goals.GoalNear(target.x, target.y, target.z, 1);

    const iter = this.pbot.pathfinder.getPathFromTo(moves, botPos, targetGoal, {
      timeout: 3000,
    });

    const { value } = iter.next();

    return value.result.status !== 'noPath';
  }

  private async iterativePathfind(
    target: Vec3,
    range: number,
  ): Promise<boolean> {
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      if (this.pbot.entity.position.distanceTo(target) < range) return true;

      this.log.info(
        `pathfinding attempt ${attempts + 1} to`,
        `(${target.x}, ${target.y}, ${target.z})`,
      );

      const step = await this.stepToward(target, range);

      if (step === 'reached') return true;
      if (step === 'nopath') return false;

      attempts++;

      if (attempts >= MAX_ATTEMPTS) break;

      await this.unstick();

      const moves = this.buildMovements();
      if (!this.isGoalReachable(target, moves)) {
        this.log.warn('goal no longer reachable after unstick');
        return false;
      }
    }

    this.log.warn('exhausted pathfinding attempts');

    return false;
  }

  private async unstick(): Promise<void> {
    this.log.info('unsticking');
    this.pbot.setControlState('back', true);
    await Utils.sleep(800);
    this.pbot.setControlState('back', false);
    await Utils.sleep(200);
  }

  private async stepToward(target: Vec3, range: number): Promise<StepResult> {
    const [err] = await wrap(
      this.pbot.pathfinder.goto(
        new goals.GoalNear(target.x, target.y, target.z, range),
      ),
    );

    if (!err) return 'reached';

    if (err.name === 'NoPath') {
      this.log.warn('no path to goal');
      return 'nopath';
    }
    this.log.info('partial path (timeout), continuing from new position');

    return 'timeout';
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

      const [lookErr] = await wrap(
        this.pbot.lookAt(new Vec3(target.x, pos.y + 1.6, target.z)),
      );
      if (lookErr) this.log.warn('lookAt failed', lookErr.message);

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
