import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { Node } from '../../src/navigation/planner/Node';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import type { NavigationAction } from '../../src/navigation/movement/Actions';

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

describe('AStar staleness', () => {
  test('abort when snapshot bumps mid-search', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 8, 0);
    const mem = new EdgeMemory();
    const ends: Record<string, unknown>[] = [];
    let armed = false;
    const telemetry = {
      searchStart(): void {},
      searchEnd(ev: Record<string, unknown>): void {
        ends.push(ev);
      },
      nodeExpand(_ev: Record<string, unknown>): void {
        if (armed) return;
        armed = true;
        w.bumpSnapshot();
      },
      pathSelected(_ev: Record<string, unknown>): void {},
      candidateGenerated(_ev: Record<string, unknown>): void {},
      candidateRejected(_ev: Record<string, unknown>): void {},
    };

    const r = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(8, 65, 0),
      mem,
      0,
      'snap',
      telemetry,
    );

    expect(r[0]?.message).toBe('world_snapshot_stale');
    expect(ends[0]?.status).toBe('aborted');
    expect(ends[0]?.reason).toBe('snapshot_stale');
  });

  test('tie-break produces identical paths on repeated search', () => {
    const w = new FixtureWorld();
    w.platformXZ(64, 0, 0, 4, 0);
    w.platformXZ(64, 0, 1, 4, 1);
    const mem = new EdgeMemory();
    const ra = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(4, 65, 1),
      mem,
      0,
      'tie_a',
    );
    const rb = AStar.search(
      w,
      new Node(0, 65, 0),
      new Node(4, 65, 1),
      mem,
      0,
      'tie_b',
    );
    expect(ra[0]).toBeNull();
    expect(rb[0]).toBeNull();
    const stripIds = (path: NavigationAction[]): string =>
      path
        .map((x): string => {
          const t = { ...x.toTelemetry() };
          delete t.action_id;
          return JSON.stringify(t);
        })
        .join('|');
    expect(stripIds(ra[1]!.path)).toBe(stripIds(rb[1]!.path));
  });
});
