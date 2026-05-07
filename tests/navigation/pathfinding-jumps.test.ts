import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { Node } from '../../src/navigation/planner/Node';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import { emptyAirCell } from '../../src/navigation/world/Collision';
import { THIN_FLOOR } from './helpers';

describe('Pathfinding jumps', () => {
  test('uses jump_up with thin-floor step geometry', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 1, 0);
    w.putCell(1, 65, 0, THIN_FLOOR);
    w.putCell(1, 66, 0, emptyAirCell());

    const r = AStar.search(
      w,

      new Node(0, 65, 0),
      new Node(1, 66, 0),
      new EdgeMemory(),
      0,
      'ju',
    );
    expect(r[0]).toBeNull();
    expect(r[1]!.path.some((a): boolean => a.kind === 'jump_up')).toBe(true);
  });
});
