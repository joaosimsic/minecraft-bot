import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import type { Bot } from 'mineflayer';
import type { NavigationAction } from './Actions';
import type { World } from '../world/World';
import { Node } from '../planner/Node';
import {
  NeighborGenerator,
  type ExpandOpts,
} from '../planner/NeighborGenerator';
import { Collision } from '../world/Collision';
import { BETA_173 } from '../world/Beta173';

export type PreValidation = { ok: true };

export type PostValidation = { ok: true };

export class NavigationValidator {
  public constructor(private readonly neighborExpandOpts?: ExpandOpts) {}

  private static velocityComponents(
    bot: Bot,
  ): { readonly x: unknown; readonly y: unknown; readonly z: unknown } | null {
    const raw = bot.entity.velocity;
    return raw ?? null;
  }

  private static velocityBounded(bot: Bot): Result<null> {
    const vRaw = NavigationValidator.velocityComponents(bot);
    if (vRaw === null) return ok(null);

    if (
      typeof vRaw.x !== 'number' ||
      typeof vRaw.y !== 'number' ||
      typeof vRaw.z !== 'number'
    ) {
      return ok(null);
    }

    const h = Math.hypot(vRaw.x, vRaw.z);
    if (h > BETA_173.POST_ACTION_MAX_HORIZONTAL_SPEED_BLOCKS_PER_TICK) {
      return fail(new Error('post_velocity_horizontal'));
    }

    if (
      Math.abs(vRaw.y) > BETA_173.POST_ACTION_MAX_VERTICAL_ABS_BLOCKS_PER_TICK
    ) {
      return fail(new Error('post_velocity_vertical'));
    }

    return ok(null);
  }

  private static footBlock(bot: Bot): { x: number; y: number; z: number } {
    const p = bot.entity.position;
    return {
      x: Math.floor(p.x),
      y: Math.floor(p.y),
      z: Math.floor(p.z),
    };
  }

  public preAction(
    world: World,
    bot: Bot,
    next: NavigationAction,
    _tick: number,
  ): Result<PreValidation> {
    const fromOp = Node.fromKey(next.from);
    if (fromOp[0] !== null) return [fromOp[0], null];
    const fromNode = fromOp[1];
    if (fromNode === null) return fail(new Error('pre_from'));

    const fb = NavigationValidator.footBlock(bot);
    if (fb.x !== fromNode.x || fb.y !== fromNode.y || fb.z !== fromNode.z) {
      return fail(new Error('pre_foot_mismatch'));
    }

    const wm = world.footMovementClass(fb.x, fb.y, fb.z);
    if (fromNode.movementClass !== wm)
      return fail(new Error('pre_movement_class'));

    const edgeOp = NeighborGenerator.queuedEdgeLegal(
      world,
      next,
      this.neighborExpandOpts,
    );
    if (edgeOp[0] !== null) return [edgeOp[0], null];

    return ok({ ok: true });
  }

  public postAction(
    world: World,
    bot: Bot,
    completed: NavigationAction,
    _tick: number,
  ): Result<PostValidation> {
    if (completed.kind === 'interact') {
      const fromOp = Node.fromKey(completed.from);
      if (fromOp[0] !== null) return [fromOp[0], null];
      const fromNode = fromOp[1];
      if (fromNode === null) return fail(new Error('post_interact_from'));

      const fb = NavigationValidator.footBlock(bot);
      if (fb.x !== fromNode.x || fb.y !== fromNode.y || fb.z !== fromNode.z) {
        return fail(new Error('post_foot_mismatch'));
      }

      const wm = world.footMovementClass(fb.x, fb.y, fb.z);
      if (fromNode.movementClass !== wm)
        return fail(new Error('post_movement_class'));

      if (
        world.closedDoorAt(
          completed.targetX,
          completed.targetY,
          completed.targetZ,
        )
      ) {
        return fail(new Error('post_door_still_closed'));
      }

      const vOp = NavigationValidator.velocityBounded(bot);
      if (vOp[0] !== null) return [vOp[0], null];

      return ok({ ok: true });
    }

    const toOp = Node.fromKey(completed.to);
    if (toOp[0] !== null) return [toOp[0], null];
    const toNode = toOp[1];
    if (toNode === null) return fail(new Error('post_to'));

    const fb = NavigationValidator.footBlock(bot);
    if (fb.x !== toNode.x || fb.y !== toNode.y || fb.z !== toNode.z) {
      return fail(new Error('post_foot_mismatch'));
    }

    const wm = world.footMovementClass(fb.x, fb.y, fb.z);
    if (toNode.movementClass !== wm)
      return fail(new Error('post_movement_class'));

    if (!Collision.canStandAt(world, toNode)) {
      return fail(new Error('post_not_standable'));
    }

    const vOp2 = NavigationValidator.velocityBounded(bot);
    if (vOp2[0] !== null) return [vOp2[0], null];

    return ok({ ok: true });
  }
}
