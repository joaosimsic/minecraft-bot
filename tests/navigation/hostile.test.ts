import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { Node } from '../../src/navigation/planner/Node';
import {
  Collision,
  emptyAirCell,
  solidGroundCell,
} from '../../src/navigation/world/Collision';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';

describe('Hostile footprint', () => {
  test('makes narrow strip unreachable', async () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 5, 0);
    w.addHostileFoot(2, 65, 0);

    const mem = new EdgeMemory();
    const r = await AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(5, 65, 0),
      mem,
      0,
      'hos',
    );

    expect(r[0]).not.toBeNull();
  });
});

describe('HostileOccupiesCell', () => {
  test('hostile in head voxel blocks standing', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 5, 4, 5, 6);
    w.putCell(5, 65, 5, solidGroundCell());
    w.putCell(5, 67, 5, emptyAirCell());
    w.addHostileFoot(5, 67, 5);

    expect(Collision.canStandAt(w, new Node(5, 66, 5, new Set()))).toBe(false);
  });

  test('hostile two cells below feet does not block stand node', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 5, 4, 5, 6);
    w.putCell(5, 65, 5, solidGroundCell());
    w.putCell(5, 67, 5, emptyAirCell());
    w.addHostileFoot(5, 64, 5);

    expect(Collision.canStandAt(w, new Node(5, 66, 5, new Set()))).toBe(true);
  });
});
