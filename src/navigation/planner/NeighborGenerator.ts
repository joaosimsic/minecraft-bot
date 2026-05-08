import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import {
  compareNodeKey,
  doorSlotKey,
  nodeKeyPlain,
  Node,
  type NodeKey,
} from './Node';
import { Collision } from '../world/Collision';
import type { World } from '../world/World';
import {
  DropDownAction,
  InteractAction,
  JumpUpAction,
  SwimDownAction,
  SwimUpAction,
  WalkAction,
  type NavigationAction,
} from '../movement/Actions';

export type Neighbor = {
  to: Node;
  action: NavigationAction;
  edgeCost: number;
};

const CARDINAL: readonly (-1 | 0 | 1)[][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

const DIAGONAL_A = [-1, 1] as const;

export type ExpandOpts = {
  diagonal?: boolean;
};

export class NeighborGenerator {
  private static aquaticBump(from: Node, to: Node): number {
    let bump = 0;
    if (from.movementClass === 'water') bump += 1;
    if (to.movementClass === 'water') bump += 1;
    return bump;
  }

  public static queuedEdgeLegal(
    world: World,
    action: NavigationAction,
    expandOpts?: ExpandOpts,
  ): Result<null> {
    const fromOp = Node.fromKey(action.from);
    if (fromOp[0] !== null) return [fromOp[0], null];
    const fromNode = fromOp[1];
    if (fromNode === null) return fail(new Error('queued_edge_from'));

    let seq = 0;
    const nextId = (_kind: string, _a: Node, _b: Node): string => {
      seq += 1;
      return `q:${seq}`;
    };

    const neighborsOp = NeighborGenerator.expand(
      world,
      fromNode,
      nextId,
      undefined,
      expandOpts,
    );
    if (neighborsOp[0] !== null) return [neighborsOp[0], null];
    const neighbors = neighborsOp[1];
    if (neighbors === null) return fail(new Error('queued_edge_expand'));

    for (const n of neighbors) {
      if (!NeighborGenerator.actionsEquivalent(n.action, action)) continue;
      return ok(null);
    }

    return fail(new Error('queued_edge_stale'));
  }

  private static actionsEquivalent(
    a: NavigationAction,
    b: NavigationAction,
  ): boolean {
    if (a.kind !== b.kind) return false;
    if (a.from !== b.from || a.to !== b.to) return false;

    if (a.kind === 'walk') {
      const bWalk = b as WalkAction;
      return a.dx === bWalk.dx && a.dz === bWalk.dz;
    }

    if (a.kind === 'jump_up') {
      const bJump = b as JumpUpAction;
      return a.dx === bJump.dx && a.dz === bJump.dz;
    }

    if (a.kind === 'drop_down') {
      const bDrop = b as DropDownAction;
      return (
        a.dx === bDrop.dx && a.dz === bDrop.dz && a.deltaY === bDrop.deltaY
      );
    }

    if (a.kind === 'swim_up' || a.kind === 'swim_down') return true;

    const ai = a as InteractAction;
    const bi = b as InteractAction;
    return (
      ai.targetX === bi.targetX &&
      ai.targetY === bi.targetY &&
      ai.targetZ === bi.targetZ
    );
  }

  public static expand(
    world: World,
    from: Node,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry?: (
      name: 'candidate_generated' | 'candidate_rejected',
      data: Record<string, unknown>,
    ) => void,
    expandOpts?: ExpandOpts,
  ): Result<Neighbor[]> {
    const byDest = new Map<NodeKey, Neighbor>();
    for (const pair of CARDINAL) {
      const dx = pair[0] as -1 | 0 | 1;
      const dz = pair[1] as -1 | 0 | 1;
      NeighborGenerator.tryWalk(
        world,
        from,
        dx,
        dz,
        nextActionId,
        emitTelemetry,
        byDest,
      );
      NeighborGenerator.tryJumpUp(
        world,
        from,
        dx,
        dz,
        nextActionId,
        emitTelemetry,
        byDest,
      );
      NeighborGenerator.tryDrop(
        world,
        from,
        dx,
        dz,
        nextActionId,
        emitTelemetry,
        byDest,
      );
    }

    if (expandOpts?.diagonal) {
      for (const dx of DIAGONAL_A) {
        for (const dz of DIAGONAL_A) {
          NeighborGenerator.tryDiagonalWalk(
            world,
            from,
            dx as -1 | 1,
            dz as -1 | 1,
            nextActionId,
            emitTelemetry,
            byDest,
          );
        }
      }
    }

    if (from.movementClass === 'water') {
      NeighborGenerator.trySwim(
        world,
        from,
        1,
        nextActionId,
        emitTelemetry,
        byDest,
      );
      NeighborGenerator.trySwim(
        world,
        from,
        -1,
        nextActionId,
        emitTelemetry,
        byDest,
      );
    }

    const keys = [...byDest.keys()].sort(compareNodeKey);
    const out: Neighbor[] = [];
    for (const k of keys) {
      const v = byDest.get(k);
      if (v === undefined) return fail(new Error('neighbor_key_missing'));
      out.push(v);
    }
    return ok(out);
  }

  private static offer(dest: Map<NodeKey, Neighbor>, n: Neighbor): boolean {
    const prev = dest.get(n.to.key);
    if (prev === undefined) {
      dest.set(n.to.key, n);
      return true;
    }

    if (n.edgeCost >= prev.edgeCost) return false;
    dest.set(n.to.key, n);
    return true;
  }

  private static tryInteract(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry:
      | ((
          name: 'candidate_generated' | 'candidate_rejected',
          data: Record<string, unknown>,
        ) => void)
      | undefined,
    byDest: Map<NodeKey, Neighbor>,
  ): void {
    const door = Collision.findClosedDoorBlockingWalk(world, from, dx, dz);
    if (door === null) return;

    const dk = doorSlotKey(door.x, door.y, door.z);
    const next = new Set(from.assumedOpenDoors);
    next.add(dk);
    const to = from.withDoors(next);
    const action = new InteractAction(
      nextActionId('interact', from, to),
      from.key,
      to.key,
      door.x,
      door.y,
      door.z,
    );

    const neighbor: Neighbor = { to, action, edgeCost: 2 };
    if (!NeighborGenerator.offer(byDest, neighbor)) return;
    emitTelemetry?.('candidate_generated', {
      from: from.key,
      to: to.key,
      action: action.toTelemetry(),
    });
  }

  private static tryWalk(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry:
      | ((
          name: 'candidate_generated' | 'candidate_rejected',
          data: Record<string, unknown>,
        ) => void)
      | undefined,
    byDest: Map<NodeKey, Neighbor>,
  ): void {
    if (!Collision.canWalkCardinal(world, from, dx, dz)) {
      emitTelemetry?.('candidate_rejected', {
        from: from.key,
        to: nodeKeyPlain(from.x + dx, from.y, from.z + dz),
        reason: 'walk_blocked',
      });
      NeighborGenerator.tryInteract(
        world,
        from,
        dx,
        dz,
        nextActionId,
        emitTelemetry,
        byDest,
      );
      return;
    }

    const to = Collision.destinationNode(
      world,
      from.x + dx,
      from.y,
      from.z + dz,
      from.assumedOpenDoors,
    );
    const action = new WalkAction(
      nextActionId('walk', from, to),
      from.key,
      to.key,
      dx,
      dz,
    );
    const neighbor: Neighbor = {
      to,
      action,
      edgeCost: 1 + NeighborGenerator.aquaticBump(from, to),
    };
    if (!NeighborGenerator.offer(byDest, neighbor)) return;

    emitTelemetry?.('candidate_generated', {
      from: from.key,
      to: to.key,
      action: action.toTelemetry(),
    });
  }

  private static tryDiagonalWalk(
    world: World,
    from: Node,
    dx: -1 | 1,
    dz: -1 | 1,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry:
      | ((
          name: 'candidate_generated' | 'candidate_rejected',
          data: Record<string, unknown>,
        ) => void)
      | undefined,
    byDest: Map<NodeKey, Neighbor>,
  ): void {
    if (!Collision.canWalkDiagonal(world, from, dx, dz)) {
      emitTelemetry?.('candidate_rejected', {
        from: from.key,
        to: nodeKeyPlain(from.x + dx, from.y, from.z + dz),
        reason: 'diagonal_walk_blocked',
      });
      return;
    }

    const to = Collision.destinationNode(
      world,
      from.x + dx,
      from.y,
      from.z + dz,
      from.assumedOpenDoors,
    );
    const action = new WalkAction(
      nextActionId('walk', from, to),
      from.key,
      to.key,
      dx,
      dz,
    );
    const neighbor: Neighbor = {
      to,
      action,
      edgeCost: 2 + NeighborGenerator.aquaticBump(from, to),
    };
    if (!NeighborGenerator.offer(byDest, neighbor)) return;

    emitTelemetry?.('candidate_generated', {
      from: from.key,
      to: to.key,
      action: action.toTelemetry(),
    });
  }

  private static tryJumpUp(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry:
      | ((
          name: 'candidate_generated' | 'candidate_rejected',
          data: Record<string, unknown>,
        ) => void)
      | undefined,
    byDest: Map<NodeKey, Neighbor>,
  ): void {
    if (!Collision.canJumpUpAdjacent(world, from, dx, dz)) {
      emitTelemetry?.('candidate_rejected', {
        from: from.key,
        to: nodeKeyPlain(from.x + dx, from.y + 1, from.z + dz),
        reason: 'jump_up_blocked',
      });
      return;
    }

    const to = Collision.destinationNode(
      world,
      from.x + dx,
      from.y + 1,
      from.z + dz,
      from.assumedOpenDoors,
    );
    const action = new JumpUpAction(
      nextActionId('jump_up', from, to),
      from.key,
      to.key,
      dx,
      dz,
    );
    const neighbor: Neighbor = {
      to,
      action,
      edgeCost: 3 + NeighborGenerator.aquaticBump(from, to),
    };
    if (!NeighborGenerator.offer(byDest, neighbor)) return;

    emitTelemetry?.('candidate_generated', {
      from: from.key,
      to: to.key,
      action: action.toTelemetry(),
    });
  }

  private static tryDrop(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry:
      | ((
          name: 'candidate_generated' | 'candidate_rejected',
          data: Record<string, unknown>,
        ) => void)
      | undefined,
    byDest: Map<NodeKey, Neighbor>,
  ): void {
    const land = Collision.dropLanding(world, from, dx, dz);
    if (land === null) {
      emitTelemetry?.('candidate_rejected', {
        from: from.key,
        to: nodeKeyPlain(from.x + dx, from.y, from.z + dz),
        reason: 'drop_unsafe_or_blocked',
      });
      return;
    }

    const action = new DropDownAction(
      nextActionId('drop_down', from, land),
      from.key,
      land.key,
      dx,
      dz,
      from.y - land.y,
    );
    const edgeCost =
      1 + (from.y - land.y) + NeighborGenerator.aquaticBump(from, land);
    const neighbor: Neighbor = { to: land, action, edgeCost };
    if (!NeighborGenerator.offer(byDest, neighbor)) return;

    emitTelemetry?.('candidate_generated', {
      from: from.key,
      to: land.key,
      action: action.toTelemetry(),
    });
  }

  private static trySwim(
    world: World,
    from: Node,
    dy: 1 | -1,
    nextActionId: (kind: string, a: Node, b: Node) => string,
    emitTelemetry:
      | ((
          name: 'candidate_generated' | 'candidate_rejected',
          data: Record<string, unknown>,
        ) => void)
      | undefined,
    byDest: Map<NodeKey, Neighbor>,
  ): void {
    const ny = from.y + dy;
    const to = Collision.destinationNode(
      world,
      from.x,
      ny,
      from.z,
      from.assumedOpenDoors,
    );
    const reason = dy === 1 ? 'swim_up_blocked' : 'swim_down_blocked';

    if (dy === -1 && to.movementClass !== 'water') {
      emitTelemetry?.('candidate_rejected', {
        from: from.key,
        to: to.key,
        reason,
      });
      return;
    }

    if (!Collision.canStandAt(world, to)) {
      emitTelemetry?.('candidate_rejected', {
        from: from.key,
        to: to.key,
        reason,
      });
      return;
    }

    const kind = dy === 1 ? 'swim_up' : 'swim_down';
    const action =
      dy === 1
        ? new SwimUpAction(nextActionId(kind, from, to), from.key, to.key)
        : new SwimDownAction(nextActionId(kind, from, to), from.key, to.key);

    const neighbor: Neighbor = {
      to,
      action,
      edgeCost: 2,
    };
    if (!NeighborGenerator.offer(byDest, neighbor)) return;

    emitTelemetry?.('candidate_generated', {
      from: from.key,
      to: to.key,
      action: action.toTelemetry(),
    });
  }
}
