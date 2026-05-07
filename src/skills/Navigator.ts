import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import { wrap } from '../shared/result';
import type { Metrics } from '../shared/Metrics';
import { NavigationController } from '../navigation/NavigationController';

export class Navigator {
  private readonly log: Logger;
  private readonly bot: Bot;
  private readonly navigation: NavigationController;

  public constructor(
    bot: Bot,
    navigation: NavigationController,
    botId: string,
    private readonly metrics: Metrics,
  ) {
    this.bot = bot;
    this.navigation = navigation;
    this.log = new Logger('Navigator', botId);
  }

  private static centerBlock(v: Vec3): Vec3 {
    return new Vec3(Math.floor(v.x) + 0.5, v.y, Math.floor(v.z) + 0.5);
  }

  public async walkTo(target: Vec3, range = 1): Promise<boolean> {
    target = Navigator.centerBlock(target);

    const start = this.bot.entity.position;
    this.metrics.inc('walk.start');
    this.log.event('walk_start', {
      target: { x: target.x, y: target.y, z: target.z },
      from: {
        x: +start.x.toFixed(2),
        y: +start.y.toFixed(2),
        z: +start.z.toFixed(2),
      },
      range,
    });
    this.log.decision('walk', 'request', {
      target: { x: target.x, y: target.y, z: target.z },
      range,
      dist: +start.distanceTo(target).toFixed(2),
    });

    if (start.distanceTo(target) <= range) {
      this.metrics.inc('walk.already_there');
      this.log.decision('walk_skip', 'already_in_range');
      this.log.event('walk_end', { ok: true, mode: 'already_there' });
      return true;
    }

    const [navErr, reached] = await wrap(this.navigation.walkTo(target, range));
    if (navErr) {
      this.log.warn('navigation stack error', navErr.message);
      this.log.event('walk_end', {
        ok: false,
        mode: 'navigator_error',
        err: navErr.message,
      });
      this.metrics.inc('walk.nav.error');
      return false;
    }

    if (reached) {
      this.metrics.inc('walk.nav.success');
      this.log.event('walk_end', { ok: true, mode: 'navigation_stack' });
      return true;
    }

    this.metrics.inc('walk.nav.fail');
    this.log.decision('walk', 'failed_not_in_range');
    this.log.event('walk_end', { ok: false, mode: 'navigation_failed' });
    return false;
  }
}
