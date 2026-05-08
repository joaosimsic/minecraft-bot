import { Vec3 } from 'vec3';
import { Utils } from '../shared/Utils';
import { Logger } from '../shared/Logger';
import type { Metrics } from '../shared/Metrics';
import type { BotMode } from './BotMode';
import type { Navigator } from '../skills/Navigator';
import { debugLog } from '../shared/debugLog';

const WALK_FAILURE_BACKOFF_BASE_MS = 5000;
const WALK_FAILURE_BACKOFF_CAP_MS = 60000;
const WALK_FAILURE_STUCK_HINT_AFTER = 5;
const WALK_FAILURE_ABANDON_AFTER = 10;

export class GuidedMode implements BotMode {
  private readonly log: Logger;
  private target: Vec3 | null = null;
  private atGoal = false;
  private consecutiveWalkFailures = 0;
  private walkSuspended = false;

  public constructor(
    private readonly navigator: Navigator,
    private readonly defaultGoal: Vec3 | null,
    botId: string,
    private readonly metrics: Metrics,
  ) {
    this.log = new Logger('GuidedMode', botId);
  }

  public setTarget(target: Vec3): void {
    this.target = target;
    this.atGoal = false;
    this.consecutiveWalkFailures = 0;
    this.walkSuspended = false;
    this.metrics.inc('target.set');
    this.log.decision('target_set', 'user_command', {
      x: target.x,
      y: target.y,
      z: target.z,
    });
    this.log.event('target_set', { x: target.x, y: target.y, z: target.z });
  }

  public onRespawn(): void {
    this.atGoal = false;
    this.consecutiveWalkFailures = 0;
    this.walkSuspended = false;
  }

  public navigationTargetLabel(): string | null {
    if (this.target !== null) {
      const t = this.target;
      return `(${Math.floor(t.x)}, ${Math.floor(t.y)}, ${Math.floor(t.z)})`;
    }
    const d = this.defaultGoal;
    if (d === null) return null;
    if (this.atGoal) return null;
    return `goal (${Math.floor(d.x)}, ${Math.floor(d.y)}, ${Math.floor(d.z)})`;
  }

  public async tick(): Promise<void> {
    if (this.atGoal) {
      // #region agent log
      debugLog('GuidedMode.ts:tick:atGoal', 'tick skipped: atGoal', {}, 'H7');
      // #endregion
      await Utils.sleep(1000);
      return;
    }

    const t = this.target ?? this.defaultGoal;
    if (t === null) {
      // #region agent log
      debugLog('GuidedMode.ts:tick:noTarget', 'tick skipped: no target', { hasTarget: this.target !== null, hasDefault: this.defaultGoal !== null }, 'H7');
      // #endregion
      await Utils.sleep(1000);
      return;
    }

    if (this.walkSuspended) {
      // #region agent log
      debugLog('GuidedMode.ts:tick', 'tick skipped: walkSuspended', { target: { x: t.x, y: t.y, z: t.z }, consecutiveWalkFailures: this.consecutiveWalkFailures }, 'H5');
      // #endregion
      await Utils.sleep(1000);
      return;
    }

    // #region agent log
    debugLog('GuidedMode.ts:tick:beforeWalkTo', 'calling walkTo', { target: { x: t.x, y: t.y, z: t.z }, consecutiveWalkFailures: this.consecutiveWalkFailures }, 'H0');
    // #endregion
    const reached = await this.navigator.walkTo(t);
    if (!reached) {
      this.consecutiveWalkFailures += 1;
      this.metrics.inc('target.failed');
      this.log.decision('target_failed', 'walk_returned_false', {
        x: t.x,
        y: t.y,
        z: t.z,
        consecutiveFailures: this.consecutiveWalkFailures,
      });
      this.log.event('target_failed', {
        x: t.x,
        y: t.y,
        z: t.z,
        consecutiveFailures: this.consecutiveWalkFailures,
      });
      if (this.consecutiveWalkFailures === WALK_FAILURE_STUCK_HINT_AFTER) {
        this.log.event('target_navigation_stuck_hint', {
          x: t.x,
          y: t.y,
          z: t.z,
          consecutiveFailures: this.consecutiveWalkFailures,
        });
        this.log.warn(
          'navigation_stuck',
          `still failing walkTo toward (${Math.floor(t.x)}, ${Math.floor(t.y)}, ${Math.floor(t.z)}) after ${WALK_FAILURE_STUCK_HINT_AFTER} attempts`,
        );
      }
      if (this.consecutiveWalkFailures >= WALK_FAILURE_ABANDON_AFTER) {
        this.walkSuspended = true;
        this.log.warn('target_abandoned', 'max_consecutive_walk_failures');
        this.metrics.inc('target.abandoned');
        this.log.event('target_abandoned', {
          x: t.x,
          y: t.y,
          z: t.z,
        });
        this.log.warn(
          'navigation_abandoned',
          `stopped retrying walkTo toward (${Math.floor(t.x)}, ${Math.floor(t.y)}, ${Math.floor(t.z)}) after ${WALK_FAILURE_ABANDON_AFTER} attempts; set a new target or respawn to retry`,
        );
        return;
      }
      const pow = this.consecutiveWalkFailures - 1;
      const raw = WALK_FAILURE_BACKOFF_BASE_MS * 2 ** pow;
      const sleepMs = Math.min(WALK_FAILURE_BACKOFF_CAP_MS, raw);
      await Utils.sleep(sleepMs);
      return;
    }

    this.consecutiveWalkFailures = 0;
    this.walkSuspended = false;
    this.metrics.inc('target.reached');
    this.log.decision('target_reached', 'walk_succeeded', {
      x: t.x,
      y: t.y,
      z: t.z,
    });
    this.log.event('target_reached', { x: t.x, y: t.y, z: t.z });
    if (this.target !== null) this.target = null;
    this.atGoal = true;
  }
}
