import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { Node } from '../../src/navigation/planner/Node';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';

describe('AStar', () => {
  test('finds straight corridor', async () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 5, 0);

    const start = new Node(0, 65, 0);
    const goal = new Node(5, 65, 0);
    const mem = new EdgeMemory();

    const r = await AStar.search(w, start, goal, mem, 0, 't1');
    expect(r[0]).toBeNull();
    expect(r[1]).not.toBeNull();

    const plan = r[1]!;
    expect(plan.path.length).toBe(5);
  });

  test('expansion budget returns no_path_budget with exact expanded count', async () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 10, 0);
    w.platformXZ(64, 40, 0, 55, 0);

    const mem = new EdgeMemory();
    const ends: Record<string, unknown>[] = [];
    const telemetry = {
      searchStart(): void {},
      searchEnd(ev: Record<string, unknown>): void {
        ends.push(ev);
      },
      nodeExpand(_ev: Record<string, unknown>): void {},
      pathSelected(_ev: Record<string, unknown>): void {},
      candidateGenerated(_ev: Record<string, unknown>): void {},
      candidateRejected(_ev: Record<string, unknown>): void {},
    };

    const r = await AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(50, 65, 0),
      mem,
      0,
      'budget',
      telemetry,
      undefined,
      undefined,
      { maxExpansions: 5 },
    );

    expect(r[0]?.message).toBe('no_path_budget');
    expect(ends[0]?.reason).toBe('expansion_budget');
    expect(ends[0]?.expanded).toBe(5);
  });

  test('yieldEvery invokes yieldImpl on unreachable search with budget', async () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 20, 20);
    w.platformXZ(64, 40, 0, 60, 20);

    let yields = 0;
    const r = await AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(50, 65, 10),
      new EdgeMemory(),
      0,
      'yield',
      undefined,
      undefined,
      undefined,
      {
        maxExpansions: 100,
        yieldEvery: 10,
        yieldImpl: async (): Promise<void> => {
          yields += 1;
        },
      },
    );

    expect(r[0]?.message).toBe('no_path_budget');
    expect(yields).toBe(Math.floor(100 / 10));
  });

  test('repeated search same optimal cost', async () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 4, 0);
    w.platformXZ(64, 0, 1, 4, 1);
    const mem = new EdgeMemory();
    const ra = await AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(4, 65, 1),
      mem,
      0,
      'tie_a',
    );
    const rb = await AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(4, 65, 1),
      mem,
      0,
      'tie_b',
    );
    expect(ra[0]).toBeNull();
    expect(rb[0]).toBeNull();
    expect(ra[1]!.cost).toBe(rb[1]!.cost);
    expect(ra[1]!.path.length).toBe(rb[1]!.path.length);
  });
});
