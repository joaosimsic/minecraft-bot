import type { NodeKey } from './Node';

export type OpenHeapEntry = {
  key: NodeKey;
  f: number;
  g: number;
  seq: number;
};

function entryBetter(a: OpenHeapEntry, b: OpenHeapEntry): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g < b.g;
  return a.seq < b.seq;
}

export class OpenHeap {
  private readonly data: OpenHeapEntry[] = [];

  public get size(): number {
    return this.data.length;
  }

  public push(entry: OpenHeapEntry): void {
    this.data.push(entry);
    this.siftUp(this.data.length - 1);
  }

  public popMin(): OpenHeapEntry | null {
    const a = this.data;
    if (a.length === 0) return null;
    const top = a[0];
    if (top === undefined) return null;
    const last = a.pop();
    if (last === undefined) return null;
    if (a.length > 0) {
      a[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    const a = this.data;
    let idx = i;
    while (idx > 0) {
      const p = (idx - 1) >> 1;
      const cur = a[idx];
      const par = a[p];
      if (cur === undefined || par === undefined) return;
      if (!entryBetter(cur, par)) return;
      a[idx] = par;
      a[p] = cur;
      idx = p;
    }
  }

  private siftDown(i: number): void {
    const a = this.data;
    const n = a.length;
    let idx = i;
    while (true) {
      const left = idx * 2 + 1;
      if (left >= n) return;
      const right = left + 1;
      let best = left;
      const el = a[idx];
      const l = a[left];
      if (el === undefined || l === undefined) return;
      if (right < n) {
        const r = a[right];
        if (r !== undefined && entryBetter(r, l)) best = right;
      }
      const b = a[best];
      if (b === undefined) return;
      if (!entryBetter(b, el)) return;
      a[idx] = b;
      a[best] = el;
      idx = best;
    }
  }
}
