import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { NeighborGenerator } from '../../src/navigation/planner/NeighborGenerator';
import { Node } from '../../src/navigation/planner/Node';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import { emptyAirCell } from '../../src/navigation/world/Collision';

describe('NeighborGenerator', () => {
  test('emits interact when closed door blocks walk', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 3, 0);
    w.platformXZ(64, 4, 0, 5, 0);
    w.addClosedDoor(3, 65, 0);

    const from = new Node(2, 65, 0);
    let n = 0;
    const id = (_k: string, _a: Node, _b: Node): string => {
      n += 1;
      return `a${n}`;
    };
    const exp = NeighborGenerator.expand(w, from, id);
    expect(exp[0]).toBeNull();

    const list = exp[1]!;
    const kinds = new Set(list.map((x): string => x.action.kind));
    expect(kinds.has('interact')).toBe(true);
  });

  test('queuedEdgeLegal accepts planned walk while geometry unchanged', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 5, 0);

    const mem = new EdgeMemory();
    const plan = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(2, 65, 0),
      mem,
      0,
      'qe',
    );
    expect(plan[0]).toBeNull();
    const first = plan[1]?.path[0];
    if (first === undefined) return;

    const q = NeighborGenerator.queuedEdgeLegal(w, first);
    expect(q[0]).toBeNull();
  });

  test('queuedEdgeLegal rejects stale walk after floor removed', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 5, 0);

    const mem = new EdgeMemory();
    const plan = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(2, 65, 0),
      mem,
      0,
      'qs',
    );
    expect(plan[0]).toBeNull();
    const first = plan[1]?.path[0];
    if (first === undefined) return;

    w.putCell(1, 64, 0, emptyAirCell());

    const q = NeighborGenerator.queuedEdgeLegal(w, first);
    expect(q[0]).not.toBeNull();
  });
});

describe('NeighborGenerator diagonal', () => {
  test('emits diagonal walks when expand opts request them', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 6, 6);
    let n = 0;
    const id = (_k: string, _a: Node, _b: Node): string => {
      n += 1;
      return `dg${n}`;
    };
    const exp = NeighborGenerator.expand(w, new Node(2, 65, 2), id, undefined, {
      diagonal: true,
    });
    expect(exp[0]).toBeNull();

    const diag = exp[1]!.filter(
      (x): boolean =>
        x.action.kind === 'walk' && x.action.dx !== 0 && x.action.dz !== 0,
    );

    expect(diag.length).toBeGreaterThan(0);
  });
});
