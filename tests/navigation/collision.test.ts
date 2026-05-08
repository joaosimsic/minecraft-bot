import { describe, expect, test } from 'bun:test';
import { Node } from '../../src/navigation/planner/Node';
import {
  Collision,
  emptyAirCell,
  solidGroundCell,
} from '../../src/navigation/world/Collision';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import { THIN_FLOOR } from './helpers';

describe('Collision vertical moves', () => {
  test('dropLanding finds standable within safe depth and null when too deep', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 2, 0);
    w.putCell(1, 64, 0, emptyAirCell());
    w.putCell(1, 62, 0, solidGroundCell());
    w.putCell(1, 63, 0, emptyAirCell());

    const land = Collision.dropLanding(w, new Node(0, 65, 0, new Set()), 1, 0);
    expect(land).not.toBeNull();
    expect(land!.y).toBe(63);

    w.putCell(1, 61, 0, solidGroundCell());
    w.putCell(1, 62, 0, emptyAirCell());

    expect(
      Collision.dropLanding(w, new Node(0, 66, 0, new Set()), 1, 0),
    ).toBeNull();
  });

  test('canJumpUpAdjacent clears thin step blocked by overhead solid', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 1, 0);
    w.putCell(1, 65, 0, THIN_FLOOR);
    w.putCell(1, 66, 0, emptyAirCell());

    expect(
      Collision.canJumpUpAdjacent(w, new Node(0, 65, 0, new Set()), 1, 0),
    ).toBe(true);

    w.putCell(1, 67, 0, solidGroundCell());

    expect(
      Collision.canJumpUpAdjacent(w, new Node(0, 65, 0, new Set()), 1, 0),
    ).toBe(false);
  });

  test('findClosedDoorBlockingWalk skips upper door half slot', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 3, 0, 9, 0);
    w.addClosedDoor(5, 64, 0);
    w.addClosedDoor(5, 65, 0);
    const from = new Node(4, 65, 0, new Set());
    expect(Collision.findClosedDoorBlockingWalk(w, from, 1, 0)?.y).toBe(64);
  });

  test('water surface air feet allow cardinal walk between columns', () => {
    const w = new FixtureWorld();
    w.markWaterFoot(0, 64, 0);
    w.markWaterFoot(1, 64, 0);
    w.putCell(0, 65, 0, emptyAirCell());
    w.putCell(0, 66, 0, emptyAirCell());
    w.putCell(1, 65, 0, emptyAirCell());
    w.putCell(1, 66, 0, emptyAirCell());
    const from = Collision.destinationNode(w, 0, 65, 0, new Set());
    expect(Collision.canStandAt(w, from)).toBe(true);
    expect(Collision.canWalkCardinal(w, from, 1, 0)).toBe(true);
  });

  test('canStandAt allows ground class over water when support cell is fluid', () => {
    const w = new FixtureWorld();
    w.markWaterFoot(0, 63, 0);
    w.putCell(0, 64, 0, emptyAirCell());
    w.putCell(0, 65, 0, emptyAirCell());
    w.putCell(0, 66, 0, emptyAirCell());
    const node = new Node(0, 65, 0, new Set(), 'ground');
    expect(Collision.canStandAt(w, node)).toBe(true);
  });
});
