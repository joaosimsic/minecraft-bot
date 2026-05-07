import { Vec3 } from 'vec3';
import { Utils } from '../shared/Utils';
import { Logger } from '../shared/Logger';
import { metrics } from '../shared/Metrics';
import type { BotMode } from './BotMode';
import type { Navigator } from '../skills/Navigator';

export class GuidedMode implements BotMode {
  private readonly log = new Logger('GuidedMode');
  private target: Vec3 | null = null;
  private atGoal = false;

  public constructor(
    private readonly navigator: Navigator,
    private readonly defaultGoal: Vec3 | null = null,
  ) {}

  public setTarget(target: Vec3): void {
    this.target = target;
    this.atGoal = false;
    metrics.inc('target.set');
    this.log.decision('target_set', 'user_command', { x: target.x, y: target.y, z: target.z });
    this.log.event('target_set', { x: target.x, y: target.y, z: target.z });
  }

  public onRespawn(): void {
    this.atGoal = false;
  }

  public async tick(): Promise<void> {
    if (this.atGoal) {
      await Utils.sleep(1000);
      return;
    }

    const t = this.target ?? this.defaultGoal;
    if (t === null) {
      await Utils.sleep(1000);
      return;
    }

    const reached = await this.navigator.walkTo(t);
    if (!reached) {
      metrics.inc('target.failed');
      this.log.decision('target_failed', 'walk_returned_false', { x: t.x, y: t.y, z: t.z });
      this.log.event('target_failed', { x: t.x, y: t.y, z: t.z });
      await Utils.sleep(5000);
      return;
    }

    metrics.inc('target.reached');
    this.log.decision('target_reached', 'walk_succeeded', { x: t.x, y: t.y, z: t.z });
    this.log.event('target_reached', { x: t.x, y: t.y, z: t.z });
    if (this.target !== null) this.target = null;
    this.atGoal = true;
  }
}
