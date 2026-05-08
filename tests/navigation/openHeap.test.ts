import { describe, expect, test } from 'bun:test';
import {
  OpenHeap,
  type OpenHeapEntry,
} from '../../src/navigation/planner/OpenHeap';

function betterOrder(a: OpenHeapEntry, b: OpenHeapEntry): number {
  if (a.f !== b.f) return a.f - b.f;
  if (a.g !== b.g) return a.g - b.g;
  return a.seq - b.seq;
}

describe('OpenHeap', () => {
  test('popMin order matches sorted baseline on random triples', () => {
    const rng = (s: number): (() => number) => {
      let x = s;
      return (): number => {
        x = (x * 1664525 + 1013904223) % 4294967296;
        return x;
      };
    };

    const rand = rng(42);
    const entries: OpenHeapEntry[] = [];
    let i = 0;
    while (i < 80) {
      i += 1;
      entries.push({
        key: `k${i}`,
        f: (rand() % 200) - 100,
        g: (rand() % 200) - 100,
        seq: i,
      });
    }

    const sorted = [...entries].sort(betterOrder);
    const heap = new OpenHeap();
    for (const e of entries) heap.push(e);

    const popped: OpenHeapEntry[] = [];
    while (heap.size > 0) {
      const e = heap.popMin();
      if (e === null) break;
      popped.push(e);
    }

    expect(popped.length).toBe(sorted.length);
    let j = 0;
    while (j < popped.length) {
      expect(popped[j]!.f).toBe(sorted[j]!.f);
      expect(popped[j]!.g).toBe(sorted[j]!.g);
      expect(popped[j]!.seq).toBe(sorted[j]!.seq);
      j += 1;
    }
  });

  test('size tracks pushes and pops', () => {
    const h = new OpenHeap();
    expect(h.size).toBe(0);
    h.push({ key: 'a', f: 1, g: 1, seq: 1 });
    h.push({ key: 'b', f: 2, g: 0, seq: 2 });
    expect(h.size).toBe(2);
    h.popMin();
    expect(h.size).toBe(1);
    h.popMin();
    expect(h.size).toBe(0);
    expect(h.popMin()).toBeNull();
  });

  test('lower g wins tie on f then older higher-g entry pops as worse', () => {
    const h = new OpenHeap();
    h.push({ key: 'x', f: 10, g: 10, seq: 1 });
    h.push({ key: 'x', f: 10, g: 5, seq: 2 });
    const first = h.popMin();
    expect(first?.g).toBe(5);
    const second = h.popMin();
    expect(second?.g).toBe(10);
  });
});
