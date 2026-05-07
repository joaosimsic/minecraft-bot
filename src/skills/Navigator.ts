import type { Bot } from 'mineflayer';
import type { Pathfinder } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { Movements, goals } from 'mineflayer-pathfinder';
import { Logger } from '../shared/Logger';
import { Door } from './Door';
import { Utils } from '../shared/Utils';
import { wrap } from '../shared/result';
import { metrics } from '../shared/Metrics';

type PathfinderBot = Bot & { pathfinder: Pathfinder };
type StepResult = 'reached' | 'timeout' | 'nopath';

const MAX_ATTEMPTS = 3;
const PATH_TIMEOUT_MS = 12000;
const MANUAL_STALL_BAIL = 12;

export class Navigator {
  private readonly log = new Logger('Navigator');
  private readonly pbot: PathfinderBot;
  private readonly badNodes = new Set<string>();

  public constructor(
    bot: Bot,
    private readonly door: Door,
  ) {
    this.pbot = bot as PathfinderBot;
  }

  private static centerBlock(v: Vec3): Vec3 {
    return new Vec3(Math.floor(v.x) + 0.5, v.y, Math.floor(v.z) + 0.5);
  }

  public async walkTo(target: Vec3, range = 1): Promise<boolean> {
    this.badNodes.clear();
    target = Navigator.centerBlock(target);

    const start = this.pbot.entity.position;
    metrics.inc('walk.start');
    this.log.event('walk_start', {
      target: { x: target.x, y: target.y, z: target.z },
      from: { x: +start.x.toFixed(2), y: +start.y.toFixed(2), z: +start.z.toFixed(2) },
      range,
    });
    this.log.decision('walk', 'request', {
      target: { x: target.x, y: target.y, z: target.z },
      range,
      dist: +start.distanceTo(target).toFixed(2),
    });

    if (start.distanceTo(target) <= range) {
      metrics.inc('walk.already_there');
      this.log.decision('walk_skip', 'already_in_range');
      this.log.event('walk_end', { ok: true, mode: 'already_there' });
      return true;
    }

    this.buildMovements();

    const reached = await this.iterativePathfind(target, range);

    if (reached) {
      metrics.inc('walk.pathfind.success');
      this.log.event('walk_end', { ok: true, mode: 'pathfind' });
      return true;
    }

    metrics.inc('walk.pathfind.fail');
    this.log.decision('walk_fallback', 'pathfind_failed_try_manual');
    const manual = await this.manualWalkTo(target, range);
    metrics.inc(manual ? 'walk.manual.success' : 'walk.manual.fail');
    this.log.event('walk_end', { ok: manual, mode: 'manual' });
    return manual;
  }

  private buildMovements(): Movements {
    const moves = new Movements(this.pbot);

    moves.canDig = false;
    moves.allow1by1towers = false;
    moves.canOpenDoors = true;
    moves.allowSprinting = false;

    const originalGetBlock = moves.getBlock.bind(moves);
    type SafeBlock = ReturnType<typeof originalGetBlock>;

    moves.getBlock = (
      pos: Vec3,
      dx: number,
      dy: number,
      dz: number,
    ): SafeBlock => {
      const block = originalGetBlock(pos, dx, dy, dz);
      const key = `${pos.x},${pos.y},${pos.z}`;

      if (this.badNodes.has(key)) {
        return Object.assign({}, block, {
          boundingBox: 'block',
          name: 'barrier',
          safe: false,
          safe2D: false,
          physical: true,
        }) as SafeBlock;
      }

      return block;
    };

    this.pbot.pathfinder.setMovements(moves);

    return moves;
  }
  private async iterativePathfind(
    target: Vec3,
    range: number,
  ): Promise<boolean> {
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      if (this.pbot.entity.position.distanceTo(target) <= range) return true;

      this.log.info(
        `pathfinding attempt ${attempts + 1} to`,
        `(${target.x}, ${target.y}, ${target.z})`,
      );

      metrics.inc('path.attempt');
      this.log.event('pathfind_attempt', { attempt: attempts + 1, target });
      await this.door.openDoorsTowardTarget(target);
      const step = await this.stepToward(target, range);
      metrics.inc(`path.result.${step}`);
      this.log.event('pathfind_result', { attempt: attempts + 1, result: step });

      if (step === 'reached') return true;
      if (step === 'nopath') {
        this.log.decision('pathfind_abort', 'no_path_to_goal', { attempt: attempts + 1 });
        return false;
      }

      const stuckPos = this.pbot.entity.position.floored();
      const yaw = this.pbot.entity.yaw;
      const frontX = stuckPos.x + Math.round(-Math.sin(yaw));
      const frontZ = stuckPos.z + Math.round(-Math.cos(yaw));
      const frontBlock = this.pbot.blockAt(new Vec3(frontX, stuckPos.y, frontZ));
      const frontIsDoor = frontBlock !== null && this.door.isDoor(frontBlock.name);

      if (frontIsDoor) {
        metrics.inc('bad_node.skip.door');
        this.log.decision('skip_bad_node', 'front_is_door', { x: frontX, y: stuckPos.y, z: frontZ });
      }

      if (!frontIsDoor) {
        this.badNodes.add(`${frontX},${stuckPos.y},${frontZ}`);
        metrics.inc('bad_node');
        this.log.decision('mark_bad_node', 'pathfind_timeout', { x: frontX, y: stuckPos.y, z: frontZ });
        this.log.event('mark_bad_node', { x: frontX, y: stuckPos.y, z: frontZ });
      }

      attempts++;

      if (attempts >= MAX_ATTEMPTS) break;

      await this.unstick(target);
      this.buildMovements();
    }

    this.log.warn('exhausted pathfinding attempts');

    return false;
  }

  private async unstick(target: Vec3): Promise<void> {
    this.log.info('unsticking safely');
    const p = this.pbot.entity.position;
    metrics.inc('unstick');
    this.log.event('unstick', {
      pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      yaw: +this.pbot.entity.yaw.toFixed(2),
    });
    this.log.decision('unstick', 'pathfind_attempt_failed');

    const pos = this.pbot.entity.position;
    const yaw = this.pbot.entity.yaw;

    const backX = Math.sin(yaw);
    const backZ = Math.cos(yaw);
    const leftX = Math.cos(yaw);
    const leftZ = -Math.sin(yaw);

    const behindFloor = this.pbot.blockAt(
      new Vec3(pos.x + backX, pos.y - 1, pos.z + backZ),
    );
    const canGoBack =
      behindFloor !== null &&
      behindFloor.boundingBox !== 'empty' &&
      behindFloor.name !== 'lava';

    const leftFloor = this.pbot.blockAt(
      new Vec3(pos.x + leftX, pos.y - 1, pos.z + leftZ),
    );
    const canGoLeft =
      leftFloor !== null &&
      leftFloor.boundingBox !== 'empty' &&
      leftFloor.name !== 'lava';

    if (canGoBack) this.pbot.setControlState('back', true);
    if (canGoLeft) this.pbot.setControlState('left', true);

    this.pbot.setControlState('jump', true);

    await Utils.sleep(800);

    this.pbot.setControlState('back', false);
    this.pbot.setControlState('left', false);
    this.pbot.setControlState('jump', false);
    await Utils.sleep(200);

    const newPos = this.pbot.entity.position;
    const [lookErr] = await wrap(
      this.pbot.lookAt(new Vec3(target.x, newPos.y + 1.6, target.z)),
    );
    if (lookErr) this.log.warn('look-after-unstick failed', lookErr.message);

    await this.door.openDoorsAhead();
    await Utils.sleep(300);
  }

  private async stepToward(target: Vec3, range: number): Promise<StepResult> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<'TIMEOUT'>((resolve): void => {
      timer = setTimeout((): void => resolve('TIMEOUT'), PATH_TIMEOUT_MS);
    });

    const gotoPromise = wrap(
      this.pbot.pathfinder.goto(
        new goals.GoalNear(target.x, target.y, target.z, range),
      ),
    );

    const result = await Promise.race([gotoPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (result === 'TIMEOUT') {
      this.pbot.pathfinder.stop();
      metrics.inc('path.result.hard_timeout');
      this.log.warn(`pathfinder.goto hard timeout after ${PATH_TIMEOUT_MS}ms`);
      this.log.event('pathfind_hard_timeout', { ms: PATH_TIMEOUT_MS, target });
      return 'timeout';
    }

    const [err] = result;

    if (!err) {
      const dist = this.pbot.entity.position.distanceTo(target);
      if (dist > range + 2) {
        this.log.warn(
          `pathfinder resolved but dist=${dist.toFixed(1)}, retrying`,
        );
        return 'timeout';
      }
      this.log.info('reached goal');
      return 'reached';
    }

    if (err.name === 'NoPath') {
      this.log.warn('no path to goal');
      return 'nopath';
    }

    this.log.info('partial path (timeout), continuing from new position');
    return 'timeout';
  }

  private async manualWalkTo(target: Vec3, range = 1): Promise<boolean> {
    this.log.info('manual walk to', `(${target.x}, ${target.y}, ${target.z})`);
    this.log.event('manual_walk_start', { target, range });
    const start = Date.now();
    const reachSq = range * range;

    let lastPos = this.pbot.entity.position.clone();
    let stalledTicks = 0;
    let iter = 0;

    while (Date.now() - start < 15000) {
      iter++;
      const pos = this.pbot.entity.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dy = target.y - pos.y;

      if (dx * dx + dz * dz < reachSq && Math.abs(dy) < 1) {
        this.pbot.setControlState('forward', false);
        this.pbot.setControlState('jump', false);
        this.log.event('manual_walk_end', { ok: true, iter, reason: 'reached' });
        return true;
      }

      const [lookErr] = await wrap(
        this.pbot.lookAt(new Vec3(target.x, pos.y + 1.6, target.z)),
      );
      if (lookErr) this.log.warn('lookAt failed', lookErr.message);

      const yaw = this.pbot.entity.yaw;
      const fdx = Math.round(-Math.sin(yaw));
      const fdz = Math.round(-Math.cos(yaw));
      const frontPos = new Vec3(
        Math.floor(pos.x + fdx),
        Math.floor(pos.y),
        Math.floor(pos.z + fdz),
      );
      const frontBlock = this.pbot.blockAt(frontPos);
      const frontIsDoor = frontBlock !== null && this.door.isDoor(frontBlock.name);

      if (frontIsDoor) {
        const [realignErr] = await wrap(
          this.pbot.lookAt(
            new Vec3(frontPos.x + 0.5, pos.y + 1.6, frontPos.z + 0.5),
          ),
        );
        if (realignErr)
          this.log.warn('door realign failed', realignErr.message);
      }

      await this.door.openDoorsAhead();

      this.pbot.setControlState('forward', true);

      const sideX = Math.floor(pos.x + Math.sign(dx) * 0.5);
      const sideZ = Math.floor(pos.z + Math.sign(dz) * 0.5);
      const front = this.pbot.blockAt(
        new Vec3(sideX, Math.floor(pos.y), sideZ),
      );
      const shouldJump =
        front !== null && front.name !== 'air' && !this.door.isDoor(front.name);
      this.pbot.setControlState('jump', shouldJump);

      const moved = pos.distanceTo(lastPos);
      if (moved < 0.05) stalledTicks++;
      if (moved >= 0.05) stalledTicks = 0;
      lastPos = pos.clone();

      const v = this.pbot.entity.velocity;

      this.log.event('manual_walk_tick', {
        iter,
        pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) },
        target: { x: target.x, y: target.y, z: target.z },
        delta: { dx: +dx.toFixed(2), dy: +dy.toFixed(2), dz: +dz.toFixed(2) },
        yaw: +yaw.toFixed(3),
        front: {
          pos: { x: frontPos.x, y: frontPos.y, z: frontPos.z },
          name: frontBlock?.name ?? null,
          isDoor: frontIsDoor,
        },
        side: {
          pos: { x: sideX, y: Math.floor(pos.y), z: sideZ },
          name: front?.name ?? null,
        },
        controls: { forward: true, jump: shouldJump },
        velocity: { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) },
        moved: +moved.toFixed(3),
        stalledTicks,
        onGround: this.pbot.entity.onGround,
      });

      if (stalledTicks >= 6) {
        metrics.inc('manual_walk.stalled');
        this.log.warn('manual walk stalled');
        this.log.event('manual_walk_stalled', {
          iter, stalledTicks,
          pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) },
          front: { name: frontBlock?.name ?? null, isDoor: frontIsDoor },
        });
      }

      if (stalledTicks >= MANUAL_STALL_BAIL) {
        this.pbot.setControlState('forward', false);
        this.pbot.setControlState('jump', false);
        metrics.inc('manual_walk.bail.stalled');
        this.log.warn(`manual walk bail after ${stalledTicks} stalled ticks`);
        this.log.event('manual_walk_end', {
          ok: false, iter, reason: 'stalled_bail', stalledTicks,
        });
        return false;
      }

      await Utils.sleep(250);
    }

    this.pbot.setControlState('forward', false);
    this.pbot.setControlState('jump', false);
    this.log.event('manual_walk_end', { ok: false, iter, reason: 'timeout' });
    return false;
  }
}
