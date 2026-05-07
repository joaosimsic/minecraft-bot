import type { Node } from './Node';

const VERTICAL_WEIGHT = 2;

export class Heuristic {
  public static estimate(a: Node, b: Node): number {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const dz = Math.abs(a.z - b.z);

    return dx + dz + dy * VERTICAL_WEIGHT;
  }
}
