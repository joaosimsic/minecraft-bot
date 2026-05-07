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
import { emptyAirCell, solidGroundCell } from './world/Collision';
import type { WorldCell } from './world/World';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'fs';
import { NAV_EVENT } from './telemetry/Events';
import { Recovery } from './recovery/Recovery';
import { NavigationRecorder } from './telemetry/Recorder';
import { NavigationController } from './NavigationController';
import { Collision } from './world/Collision';
import { ValidationError } from './movement/Validator';
import { WalkAction, type NavigationAction } from './movement/Actions';

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

const THIN_FLOOR: WorldCell = { blocksBody: false, topSupportStand: true };

class CaptureRecorder extends NavigationRecorder {
  public readonly frames: Array<{
    type: string;
    data?: Record<string, unknown>;
  }> = [];

  public override emit(type: string, data?: Record<string, unknown>): void {
    this.frames.push({ type, data });
    super.emit(type, data);
  }
}

describe('EdgeMemory limits', () => {
  test('clamps learned add after many failures on same edge', () => {
    const m = new EdgeMemory();
    let i = 0;
    while (i < 50) {
      void m.recordFailure('0,0,0', '1,0,0', 'walk', 0);
      i += 1;
    }
    const c = m.costWithMemory('0,0,0', '1,0,0', 'walk', 1, 0);
    expect(c).toBe(41);
  });

  test('corrupt persist file yields empty memory', () => {
    const fp = join(
      tmpdir(),
      `nav-bad-${Math.random().toString(36).slice(2)}.json`,
    );
    writeFileSync(fp, '{broken', 'utf8');
    const m = new EdgeMemory({ persistPath: fp });
    expect(m.costWithMemory('0,0,0', '1,0,0', 'walk', 1, 10)).toBe(1);
    unlinkSync(fp);
  });

  test('persist trim keeps newest rows by lastFailureTick', () => {
    const fp = join(
      tmpdir(),
      `nav-trim-${Math.random().toString(36).slice(2)}.json`,
    );
    const m1 = new EdgeMemory({
      persistPath: fp,
      maxEntries: 5,
      saveEveryFailures: 1,
    });
    let j = 0;
    while (j < 12) {
      void m1.recordFailure(`${j},0,0`, `${j},1,0`, 'walk', 100 + j);
      j += 1;
    }
    const raw = readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw) as { rows: { id: string }[] };
    expect(parsed.rows.length).toBe(5);
    unlinkSync(fp);
  });
});

describe('Recovery budgets', () => {
  test('transient replan exhausts separately from verified failures', () => {
    const rec = new CaptureRecorder('t_recovery');
    const r = new Recovery(14, 6, new EdgeMemory(), rec);
    let n = 0;
    while (n < 6) {
      const [e] = r.consumeTransientReplan('pre', { x: 0, y: 0, z: 0 });
      expect(e).toBeNull();
      n += 1;
    }
    const [fail] = r.consumeTransientReplan('pre', { x: 0, y: 0, z: 0 });
    expect(fail?.message).toBe('transient_replan_budget');
    expect(r.canReplan()).toBe(true);
  });

  test('replen budget rejects after exhaustion', () => {
    const rec = new CaptureRecorder('t_recovery2');
    const r = new Recovery(1, 6, new EdgeMemory(), rec);
    expect(r.consumeReplan('a', { x: 0, y: 0, z: 0 })[0]).toBeNull();
    expect(r.consumeReplan('b', { x: 0, y: 0, z: 0 })[0]?.message).toBe(
      'replan_budget',
    );
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

describe('NavigationController probe lifecycle', () => {
  test('does not subscribe physicsTick listener by default', () => {
    const bot = new EventEmitter() as unknown as Bot;

    (
      bot as unknown as {
        entity: Bot['entity'];
        time: { age: number };
      }
    ).entity = {
      position: {
        distanceTo(): number {
          return 999;
        },
      },
    } as unknown as Bot['entity'];
    (
      bot as unknown as {
        time: { age: number };
      }
    ).time = { age: 0 };

    bot.blockAt = (): null => null;
    bot.entities = {};
    bot.setControlState = (): void => {};

    new NavigationController(bot);

    const ee = bot as unknown as EventEmitter;

    expect(ee.listenerCount('physicsTick')).toBe(0);
    let pulse = 0;
    while (pulse < 200) {
      ee.emit('physicsTick');
      pulse += 1;
    }
    expect(ee.listenerCount('physicsTick')).toBe(0);
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
});

describe('Telemetry observed', () => {
  test('movement_fail emits validator observed payloads', () => {
    const rec = new CaptureRecorder('telemetry');
    const mem = new EdgeMemory();
    const r = new Recovery(14, 6, mem, rec);
    void r.recordVerifiedFailure(
      '0,0,0',
      '1,0,0',
      'walk',
      0,
      'post_foot_mismatch',
      'post_action',
      new WalkAction(
        'a',
        new Node(0, 65, 0).key,

        new Node(1, 65, 0).key,

        1,
        0,
      ),
      new ValidationError('post_foot_mismatch', {
        expected: { x: 1, y: 65, z: 0 },
        got: { x: 0, y: 65, z: 0 },
      }).observed,
    );

    const hit = rec.frames.find(
      (f): boolean => f.type === NAV_EVENT.MOVEMENT_FAIL,
    );
    expect(hit?.data?.observed).toEqual({
      expected: { x: 1, y: 65, z: 0 },
      got: { x: 0, y: 65, z: 0 },
    });
  });
});

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
