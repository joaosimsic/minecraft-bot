import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { Node } from '../../src/navigation/planner/Node';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import {
  solidGroundCell,
  emptyAirCell,
} from '../../src/navigation/world/Collision';
import { THIN_FLOOR } from './helpers';

function buildComplexHouseWorld(): FixtureWorld {
  const w = new FixtureWorld();
  const yf = 64;
  const h0 = 4;
  const h1 = 8;

  w.platformXZ(yf, 0, 0, 12, 12);

  let x = h0;
  while (x <= h1) {
    let z = h0;
    while (z <= h1) {
      const perimeter = x === h0 || x === h1 || z === h0 || z === h1;
      const door = z === h1 && (x === 5 || x === 6);
      if (perimeter && !door) {
        let y = 65;
        while (y <= 67) {
          w.putCell(x, y, z, solidGroundCell());
          y += 1;
        }
      }

      const overLoft = x >= 5 && x <= 6 && z >= 5 && z <= 6;
      if (!overLoft) w.putCell(x, 68, z, solidGroundCell());

      z += 1;
    }
    x += 1;
  }

  w.addClosedDoor(5, 65, 8);
  w.addClosedDoor(6, 65, 8);

  w.putCell(6, 65, 6, THIN_FLOOR);

  let sx = 5;
  while (sx <= 6) {
    let sz = 5;
    while (sz <= 6) {
      w.putCell(sx, 69, sz, emptyAirCell());
      sz += 1;
    }
    sx += 1;
  }

  let lx = 5;
  while (lx <= 6) {
    let lz = 5;
    while (lz <= 6) {
      w.putCell(lx, 66, lz, THIN_FLOOR);
      lz += 1;
    }
    lx += 1;
  }

  return w;
}

describe('AStar complex house integration', () => {
  test('navigates yard, double doors, and interior staircase to loft', async () => {
    const w = buildComplexHouseWorld();
    const start = new Node(6, 65, 11);
    const goal = new Node(5, 67, 6);
    const result = await AStar.search(
      w,
      start,
      goal,
      new EdgeMemory(),
      0,
      'complex-house',
    );

    expect(result[0]).toBeNull();
    expect(result[1]).not.toBeNull();

    const path = result[1]!.path;

    expect(
      path.some((a): boolean => {
        return a.kind === 'interact';
      }),
    ).toBe(true);

    expect(
      path.some((a): boolean => {
        return a.kind === 'jump_up';
      }),
    ).toBe(true);
  });
});
