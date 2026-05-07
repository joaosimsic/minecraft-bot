import type { Bot } from 'mineflayer';
import { Logger } from '../shared/Logger';
import { metrics } from '../shared/Metrics';

type EntityPos = Bot['entity']['position'];

interface BotEntityExtras {
  velocity: { x: number; y: number; z: number };
  isInWater?: boolean;
  isInLava?: boolean;
  isCollidedHorizontally?: boolean;
  isCollidedVertically?: boolean;
}

export class Telemetry {
  private readonly log = new Logger('Telemetry');
  private timer: NodeJS.Timeout | null = null;
  private summaryTimer: NodeJS.Timeout | null = null;
  private lastSig = '';
  private lastTrailPos: EntityPos | null = null;
  private lastMovePos: EntityPos | null = null;
  private lastCollidedH = false;
  private lastCollidedV = false;

  public constructor(
    private readonly bot: Bot,
    private readonly sampleMs: number,
    private readonly summaryMs: number,
    private readonly trailMinBlocks: number,
  ) {}

  public start(): void {
    this.bind();
    this.timer = setInterval((): void => this.snapshot('tick'), this.sampleMs);
    this.summaryTimer = setInterval((): void => this.dumpSummary(), this.summaryMs);
  }

  private bind(): void {
    this.bot.on('spawn', (): void => {
      this.log.event('spawn');
      this.snapshot('spawn');
      const e = this.bot.entity;
      if (!e) return;
      this.lastTrailPos = e.position.clone();
      this.lastMovePos = e.position.clone();
      metrics.pushPos(+e.position.x.toFixed(2), +e.position.y.toFixed(2), +e.position.z.toFixed(2));
    });

    this.bot.on('death', (): void => {
      metrics.inc('deaths');
      this.log.event('death');
    });

    this.bot.on('kicked', (reason: string): void => {
      metrics.inc('kicks');
      this.log.event('kicked', { reason });
    });

    this.bot.on('end', (): void => this.log.event('disconnect'));

    this.bot.on('error', (e: Error): void =>
      this.log.event('bot_error', { msg: e.message }),
    );

    this.bot.on('health', (): void =>
      this.log.event('health', { hp: this.bot.health, food: this.bot.food }),
    );

    this.bot.on('chat', (user: string, msg: string): void => {
      metrics.inc('chats');
      this.log.event('chat', { user, msg });
    });

    this.bot.on('respawn', (): void => this.log.event('respawn'));

    this.bot.on('forcedMove', (): void => {
      const p = this.bot.entity.position;
      metrics.inc('forced_moves');
      this.log.event('forced_move', {
        pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      });
    });

    this.bot.on('move', (): void => this.onMove());
  }

  private onMove(): void {
    const e = this.bot.entity;
    if (!e) return;
    const p = e.position;

    if (this.lastMovePos !== null) {
      const moved = p.distanceTo(this.lastMovePos);
      if (moved > 0) metrics.add('distance_walked', moved);
    }
    this.lastMovePos = p.clone();

    if (this.lastTrailPos === null) {
      this.lastTrailPos = p.clone();
      return;
    }

    const trailDelta = p.distanceTo(this.lastTrailPos);
    if (trailDelta >= this.trailMinBlocks) {
      const px = +p.x.toFixed(2);
      const py = +p.y.toFixed(2);
      const pz = +p.z.toFixed(2);
      metrics.pushPos(px, py, pz);
      this.log.event('position', {
        pos: { x: px, y: py, z: pz },
        delta: +trailDelta.toFixed(3),
        yaw: +e.yaw.toFixed(3),
        onGround: e.onGround,
      });
      this.lastTrailPos = p.clone();
    }

    this.checkCollisions();
  }

  private checkCollisions(): void {
    const e = this.bot.entity as (typeof this.bot.entity) & BotEntityExtras;
    const collH = e.isCollidedHorizontally === true;
    const collV = e.isCollidedVertically === true;

    if (collH !== this.lastCollidedH) {
      this.lastCollidedH = collH;
      this.emitCollisionChange('h', collH);
    }
    if (collV !== this.lastCollidedV) {
      this.lastCollidedV = collV;
      this.emitCollisionChange('v', collV);
    }
  }

  private emitCollisionChange(axis: 'h' | 'v', started: boolean): void {
    const e = this.bot.entity;
    const p = e.position;
    const yaw = e.yaw;

    if (!started) {
      this.log.event('collision_end', {
        axis,
        pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      });
      return;
    }

    metrics.inc(`collision.${axis}`);
    const fdx = Math.round(-Math.sin(yaw));
    const fdz = Math.round(-Math.cos(yaw));
    const frontPos = p.floored().offset(fdx, 0, fdz);
    const front = this.bot.blockAt(frontPos);
    const above = this.bot.blockAt(p.floored().offset(0, 2, 0));

    this.log.event('collision_start', {
      axis,
      pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      yaw: +yaw.toFixed(3),
      front: { name: front?.name ?? null, x: frontPos.x, y: frontPos.y, z: frontPos.z },
      above: { name: above?.name ?? null },
    });
  }

  private dumpSummary(): void {
    const s = metrics.summary();
    this.log.info('summary', JSON.stringify(s.counters));
    this.log.event('summary', {
      uptimeMs: s.uptimeMs,
      counters: s.counters,
      trailLen: s.trailLen,
      lastPos: s.lastPos,
    });
  }

  private snapshot(reason: string): void {
    const e = this.bot.entity as (typeof this.bot.entity) & BotEntityExtras;
    if (!e) return;

    const { x, y, z } = e.position;
    const px = +x.toFixed(2);
    const py = +y.toFixed(2);
    const pz = +z.toFixed(2);
    const yaw = +e.yaw.toFixed(2);

    const sig = `${px}|${py}|${pz}|${yaw}|${this.bot.health}|${this.bot.food}`;
    if (reason === 'tick' && sig === this.lastSig) return;
    this.lastSig = sig;

    const v = e.velocity;

    this.log.event('state', {
      reason,
      pos: { x: px, y: py, z: pz },
      yaw,
      pitch: +e.pitch.toFixed(2),
      hp: this.bot.health,
      food: this.bot.food,
      onGround: e.onGround,
      velocity: { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) },
      isInWater: e.isInWater ?? null,
      isInLava: e.isInLava ?? null,
      collidedH: e.isCollidedHorizontally ?? null,
      collidedV: e.isCollidedVertically ?? null,
    });
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    this.timer = null;
    this.summaryTimer = null;

    this.dumpSummary();
  }
}
