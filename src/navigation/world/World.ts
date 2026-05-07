import type { Node } from '../planner/Node';

export type MovementClass = 'ground' | 'water';

export interface WorldCell {
  blocksBody: boolean;
  topSupportStand: boolean;
}

export interface World {
  cell(x: number, y: number, z: number): WorldCell;
  closedDoorAt(x: number, y: number, z: number): boolean;
  footMovementClass(x: number, y: number, z: number): MovementClass;
  hostileOccupiesFootCell(x: number, y: number, z: number): boolean;
  readonly snapshotGeneration?: number;
}

export function worldSupportAndBody(
  world: World,
  node: Node,
): [WorldCell, WorldCell, WorldCell] {
  const below = world.cell(node.x, node.y - 1, node.z);
  const feet = world.cell(node.x, node.y, node.z);
  const head = world.cell(node.x, node.y + 1, node.z);
  return [below, feet, head];
}
