import { describe, expect, test } from 'bun:test';
import { AStar } from '../../src/navigation/planner/AStar';
import { NeighborGenerator } from '../../src/navigation/planner/NeighborGenerator';
import { Node } from '../../src/navigation/planner/Node';
import { NavigationValidator } from '../../src/navigation/movement/Validator';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { FixtureWorld } from '../../src/navigation/test/FixtureWorld';
import { emptyAirCell } from '../../src/navigation/world/Collision';
import { mockBot } from './helpers';

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
