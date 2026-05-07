import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import type { MovementClass } from '../world/World';

export type NodeKey = string;

export type { MovementClass };

export function doorSlotKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class Node {
  public readonly assumedOpenDoors: ReadonlySet<string>;

  public constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly z: number,
    assumedOpenDoors: ReadonlySet<string> = new Set(),
    public readonly movementClass: MovementClass = 'ground',
  ) {
    this.assumedOpenDoors = assumedOpenDoors;
  }

  public get key(): NodeKey {
    let k = `${this.x},${this.y},${this.z}`;
    if (this.assumedOpenDoors.size > 0) {
      const suffix = [...this.assumedOpenDoors].sort().join(';');
      k += `|${suffix}`;
    }
    if (this.movementClass === 'water') k += '|m:w';
    return k;
  }

  public footEquals(other: Node): boolean {
    if (this.x !== other.x) return false;
    if (this.y !== other.y) return false;
    if (this.z !== other.z) return false;
    if (this.movementClass !== other.movementClass) return false;
    return true;
  }

  public withDoors(next: ReadonlySet<string>): Node {
    return new Node(this.x, this.y, this.z, next, this.movementClass);
  }

  public static fromKey(key: NodeKey): Result<Node> {
    return parseNodeKey(key);
  }
}

export function nodeKeyPlain(x: number, y: number, z: number): NodeKey {
  return `${x},${y},${z}`;
}

export function parseNodeKey(key: NodeKey): Result<Node> {
  let mc: MovementClass = 'ground';
  let trimmed = key;
  if (trimmed.endsWith('|m:w')) {
    mc = 'water';
    trimmed = trimmed.slice(0, trimmed.length - 4);
  }

  const pipe = trimmed.indexOf('|');
  const base = pipe === -1 ? trimmed : trimmed.slice(0, pipe);
  const suffix = pipe === -1 ? '' : trimmed.slice(pipe + 1);
  const parts = base.split(',');
  if (parts.length !== 3) return fail(new Error('invalid_node_key'));

  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return fail(new Error('invalid_node_key_coords'));
  }

  const doorsRaw = suffix === '' ? [] : suffix.split(';');
  const doors = doorsRaw.filter((d): boolean => d.length > 0);
  return ok(new Node(x, y, z, new Set(doors), mc));
}

export function compareNodeKey(a: NodeKey, b: NodeKey): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
