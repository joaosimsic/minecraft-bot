import { BETA_173 } from './Beta173';
import { doorSlotKey, Node } from '../planner/Node';
import type { World, WorldCell } from './World';
import { worldSupportAndBody } from './World';

export class Collision {
  public static destinationNode(
    world: World,
    x: number,
    y: number,
    z: number,
    assumed: ReadonlySet<string>,
  ): Node {
    const mc = world.footMovementClass(x, y, z);
    return new Node(x, y, z, assumed, mc);
  }

  public static findStandableNear(
    world: World,
    x: number,
    y: number,
    z: number,
    maxDy: number,
    maxXZ: number = 4,
  ): Node | null {
    const direct = Collision.destinationNode(world, x, y, z, new Set());
    if (Collision.canStandAt(world, direct)) return direct;

    let r = 0;
    while (r <= maxXZ) {
      let best: Node | null = null;
      let bestScore = Infinity;
      let dx = -r;
      while (dx <= r) {
        let dz = -r;
        while (dz <= r) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) === r) {
            let dy = 0;
            while (dy <= maxDy) {
              const ys = dy === 0 ? [0] : [-dy, dy];
              for (const sy of ys) {
                const cand = Collision.destinationNode(
                  world,
                  x + dx,
                  y + sy,
                  z + dz,
                  new Set(),
                );
                if (!Collision.canStandAt(world, cand)) continue;
                const score = dx * dx + dz * dz + sy * sy * 4;
                if (score >= bestScore) continue;
                best = cand;
                bestScore = score;
              }
              dy += 1;
            }
          }
          dz += 1;
        }
        dx += 1;
      }
      if (best !== null) return best;
      r += 1;
    }

    return null;
  }

  public static canStandAt(world: World, node: Node): boolean {
    if (world.hostileOccupiesCell(node.x, node.y, node.z)) return false;
    if (world.hostileOccupiesCell(node.x, node.y + 1, node.z)) return false;

    if (node.movementClass !== 'water') {
      const [below] = worldSupportAndBody(world, node);
      if (!below.topSupportStand) return false;
    }

    if (
      Collision.bodyBlocked(
        world,
        node.x,
        node.y,
        node.z,
        node.assumedOpenDoors,
      )
    )
      return false;

    if (
      Collision.bodyBlocked(
        world,
        node.x,
        node.y + 1,
        node.z,
        node.assumedOpenDoors,
      )
    )
      return false;

    return true;
  }

  public static canWalkCardinal(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
  ): boolean {
    if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
    const neighbor = Collision.destinationNode(
      world,
      from.x + dx,
      from.y,
      from.z + dz,
      from.assumedOpenDoors,
    );
    if (!Collision.canStandAt(world, neighbor)) return false;
    return true;
  }

  public static canWalkDiagonal(
    world: World,
    from: Node,
    dx: -1 | 1,
    dz: -1 | 1,
  ): boolean {
    if (!Collision.canWalkCardinal(world, from, dx, 0)) return false;
    if (!Collision.canWalkCardinal(world, from, 0, dz)) return false;
    const diagonal = Collision.destinationNode(
      world,
      from.x + dx,
      from.y,
      from.z + dz,
      from.assumedOpenDoors,
    );
    if (!Collision.canStandAt(world, diagonal)) return false;
    return true;
  }

  public static canJumpUpAdjacent(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
  ): boolean {
    if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
    const nx = from.x + dx;
    const nz = from.z + dz;
    const to = Collision.destinationNode(
      world,
      nx,
      from.y + 1,
      nz,
      from.assumedOpenDoors,
    );
    if (!Collision.canStandAt(world, to)) return false;

    const stepBlocked = Collision.bodyBlocked(
      world,
      nx,
      from.y,
      nz,
      from.assumedOpenDoors,
    );
    if (stepBlocked) return false;

    const jumpHeadY = from.y + BETA_173.PLAYER_BODY_HEIGHT_BLOCKS;
    if (Collision.bodyBlocked(world, nx, jumpHeadY, nz, from.assumedOpenDoors))
      return false;
    return true;
  }

  public static dropLanding(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
  ): Node | null {
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
    const nx = from.x + dx;
    const nz = from.z + dz;
    if (Collision.bodyBlocked(world, nx, from.y, nz, from.assumedOpenDoors))
      return null;
    if (Collision.bodyBlocked(world, nx, from.y + 1, nz, from.assumedOpenDoors))
      return null;

    let y = from.y - 1;
    const minY = from.y - BETA_173.SAFE_FALL_HEIGHT_BLOCKS;
    while (y >= minY) {
      const candidate = Collision.destinationNode(
        world,
        nx,
        y,
        nz,
        from.assumedOpenDoors,
      );
      if (Collision.canStandAt(world, candidate)) return candidate;
      y -= 1;
    }
    return null;
  }

  public static findClosedDoorBlockingWalk(
    world: World,
    from: Node,
    dx: -1 | 0 | 1,
    dz: -1 | 0 | 1,
  ): { x: number; y: number; z: number } | null {
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
    if (Collision.canWalkCardinal(world, from, dx, dz)) return null;
    const nx = from.x + dx;
    const nz = from.z + dz;
    const scanYs = [from.y - 1, from.y, from.y + 1, from.y + 2];
    const n = scanYs.length;
    let i = 0;
    while (i < n) {
      const y = scanYs[i]!;
      if (!world.closedDoorAt(nx, y, nz)) {
        i += 1;
        continue;
      }
      const dk = doorSlotKey(nx, y, nz);
      if (from.assumedOpenDoors.has(dk)) {
        i += 1;
        continue;
      }
      const py = Collision.preferredDoorY(world, nx, y, nz);
      return { x: nx, y: py, z: nz };
    }
    return null;
  }

  private static preferredDoorY(
    world: World,
    x: number,
    y: number,
    z: number,
  ): number {
    if (world.closedDoorAt(x, y - 1, z)) return y - 1;
    return y;
  }

  private static doorAssumedOpen(
    world: World,
    x: number,
    y: number,
    z: number,
    assumed: ReadonlySet<string>,
  ): boolean {
    if (!world.closedDoorAt(x, y, z)) return false;
    return assumed.has(doorSlotKey(x, y, z));
  }

  private static bodyBlocked(
    world: World,
    x: number,
    y: number,
    z: number,
    assumed: ReadonlySet<string>,
  ): boolean {
    if (Collision.doorAssumedOpen(world, x, y, z, assumed)) return false;
    return world.cell(x, y, z).blocksBody;
  }
}

export function emptyAirCell(): WorldCell {
  return { blocksBody: false, topSupportStand: false };
}

export function solidGroundCell(): WorldCell {
  return { blocksBody: true, topSupportStand: true };
}
