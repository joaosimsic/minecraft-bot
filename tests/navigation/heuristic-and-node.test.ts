import { describe, expect, test } from 'bun:test';
import { Heuristic } from '../../src/navigation/planner/Heuristic';
import { Node, parseNodeKey } from '../../src/navigation/planner/Node';

describe('Heuristic', () => {
  test('manhattan with vertical weight', () => {
    const a = new Node(0, 0, 0);
    const b = new Node(1, 2, 3);
    expect(Heuristic.estimate(a, b)).toBe(1 + 3 + 2 * 2);
  });
});

describe('parseNodeKey', () => {
  test('restores water movement class via |m:w suffix', () => {
    const parsed = parseNodeKey('4,65,-1|m:w');
    expect(parsed[0]).toBeNull();
    if (parsed[1] === null) return;
    expect(parsed[1].movementClass).toBe('water');
  });
});
