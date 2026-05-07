import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Bot } from 'mineflayer';
import { Heuristic } from './planner/Heuristic';
import { Node, parseNodeKey } from './planner/Node';
import { AStar } from './planner/AStar';
import { NeighborGenerator } from './planner/NeighborGenerator';
import { EdgeMemory } from './recovery/EdgeMemory';
import { FixtureWorld } from './test/FixtureWorld';
import { NavigationValidator } from './movement/Validator';
import { emptyAirCell } from './world/Collision';

describe('Heuristic', () => {
  test('manhattan with vertical weight', () => {
    const a = new Node(0, 0, 0);
    const b = new Node(1, 2, 3);
    expect(Heuristic.estimate(a, b)).toBe(1 + 3 + 2 * 2);
  });
});

describe('EdgeMemory', () => {
  test('penalty decay reduces learned add', () => {
    const m = new EdgeMemory();
    void m.recordFailure('0,0,0', '1,0,0', 'walk', 0);

    const t0 = m.snapshotRow('0,0,0', '1,0,0', 'walk', 5000);
    expect(t0).not.toBeNull();
    if (t0 === null) return;
    expect(t0.learnedAdd).toBeLessThan(5);
  });
});

describe('AStar', () => {
  test('finds straight corridor', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 5, 0);

    const start = new Node(0, 65, 0);
    const goal = new Node(5, 65, 0);
    const mem = new EdgeMemory();

    const r = AStar.search(w, start, goal, mem, 0, 't1');
    expect(r[0]).toBeNull();
    expect(r[1]).not.toBeNull();

    const plan = r[1]!;
    expect(plan.path.length).toBe(5);
  });
});

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

function mockBot(
  x: number,
  y: number,
  z: number,
  vel?: { x: number; y: number; z: number },
): Bot {
  return {
    entity: {
      position: { x: x + 0.3, y, z: z + 0.4 },
      velocity: vel ?? { x: 0, y: 0, z: 0 },
    },
  } as Bot;
}

describe('NavigationValidator', () => {
  test('preAction rejects foot mismatch', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 3, 0);

    const mem = new EdgeMemory();
    const plan = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(2, 65, 0),
      mem,
      0,
      'pv',
    );
    expect(plan[0]).toBeNull();
    const first = plan[1]?.path[0];
    if (first === undefined) return;

    const v = new NavigationValidator();
    const badFoot = v.preAction(w, mockBot(2, 65, 0), first, 0);
    expect(badFoot[0]).not.toBeNull();

    const okFoot = v.preAction(w, mockBot(0, 65, 0), first, 0);
    expect(okFoot[0]).toBeNull();
  });

  test('postAction interact requires door open in world', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 3, 0);
    w.platformXZ(64, 4, 0, 5, 0);
    w.addClosedDoor(3, 65, 0);

    const from = new Node(2, 65, 0);
    let n = 0;
    const id = (_k: string, _a: Node, _b: Node): string => {
      n += 1;
      return `i${n}`;
    };
    const exp = NeighborGenerator.expand(w, from, id);
    expect(exp[0]).toBeNull();
    const list = exp[1]!;
    const interact = list.find((x): boolean => x.action.kind === 'interact');
    if (interact === undefined) return;

    const act = interact.action;
    const v = new NavigationValidator();

    const closedPost = v.postAction(w, mockBot(2, 65, 0), act, 0);
    expect(closedPost[0]).not.toBeNull();

    w.closedDoors.delete(FixtureWorld.k(3, 65, 0));
    w.putCell(3, 65, 0, emptyAirCell());

    const openPost = v.postAction(w, mockBot(2, 65, 0), act, 0);
    expect(openPost[0]).toBeNull();
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

describe('EdgeMemory disk', () => {
  test('persists and reloads learned rows', () => {
    const fp = join(
      tmpdir(),
      `nav-edges-${Math.random().toString(36).slice(2)}.json`,
    );
    const m1 = new EdgeMemory({
      persistPath: fp,
      maxEntries: 100,
      saveEveryFailures: 1,
    });

    void m1.recordFailure('0,0,0', '1,0,0', 'walk', 10);
    expect(existsSync(fp)).toBe(true);

    const m2 = new EdgeMemory({ persistPath: fp, maxEntries: 100 });
    const cost = m2.costWithMemory('0,0,0', '1,0,0', 'walk', 1, 10);
    expect(cost).toBeGreaterThan(1);

    unlinkSync(fp);
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

describe('Hostile footprint', () => {
  test('makes narrow strip unreachable', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 5, 0);
    w.addHostileFoot(2, 65, 0);

    const mem = new EdgeMemory();
    const r = AStar.search(
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

describe('Post velocity', () => {
  test('reject when horizontal speed exceeds Beta 1.7.3 caps', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 3, 0);

    const mem = new EdgeMemory();
    const plan = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(1, 65, 0),
      mem,
      0,
      'pv2',
    );

    expect(plan[0]).toBeNull();

    const step = plan[1]!.path[0];
    if (step === undefined) return;

    const v = new NavigationValidator();
    const slammed = mockBot(1, 65, 0, { x: 9.2, y: 0, z: 0 });

    const bad = v.postAction(w, slammed, step, 0);
    expect(bad[0]).not.toBeNull();

    const chill = mockBot(1, 65, 0);

    const good = v.postAction(w, chill, step, 0);
    expect(good[0]).toBeNull();
  });
});
