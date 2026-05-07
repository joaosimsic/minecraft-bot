export interface PosSample {
  ts: number;
  x: number;
  y: number;
  z: number;
}

export interface MetricsSnapshot {
  uptimeMs: number;
  counters: Record<string, number>;
  trailLen: number;
  lastPos: PosSample | null;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly trail: PosSample[] = [];
  private readonly maxTrail: number = 500;
  private readonly startedAt: number = Date.now();
  private readonly counterSamples: Array<{
    ts: number;
    counters: Map<string, number>;
  }> = [];

  public inc(key: string, by: number = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  public add(key: string, val: number): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + val);
  }

  public set(key: string, val: number): void {
    this.counters.set(key, val);
  }

  public get(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  public pushPos(x: number, y: number, z: number): void {
    this.trail.push({ ts: Date.now(), x, y, z });
    if (this.trail.length > this.maxTrail) this.trail.shift();
  }

  public uptimeMs(): number {
    return Date.now() - this.startedAt;
  }

  public summary(): MetricsSnapshot {
    const last =
      this.trail.length > 0 ? this.trail[this.trail.length - 1]! : null;

    return {
      uptimeMs: this.uptimeMs(),
      counters: Object.fromEntries(this.counters),
      trailLen: this.trail.length,
      lastPos: last,
    };
  }

  public ingestSampleForWindow(): void {
    const now = Date.now();
    const last = this.counterSamples[this.counterSamples.length - 1];
    if (last !== undefined && now - last.ts < 1000) return;
    this.counterSamples.push({ ts: now, counters: new Map(this.counters) });
    const cutoff = now - 150_000;
    while (
      this.counterSamples.length > 0 &&
      this.counterSamples[0]!.ts < cutoff
    ) {
      this.counterSamples.shift();
    }
  }

  public windowCounterDelta(
    keys: string[],
    windowMs: number,
  ): Record<string, number> {
    const now = Date.now();
    const boundary = now - windowMs;
    let baseline: Map<string, number> = new Map();
    for (const s of this.counterSamples) {
      if (s.ts <= boundary) baseline = s.counters;
    }
    if (baseline.size === 0 && this.counterSamples.length > 0) {
      baseline = this.counterSamples[0]!.counters;
    }
    const out: Record<string, number> = {};
    for (const key of keys) {
      const cur = this.counters.get(key) ?? 0;
      const old = baseline.get(key) ?? 0;
      out[key] = cur - old;
    }
    return out;
  }

  public trailDump(): PosSample[] {
    return this.trail.slice();
  }

  public reset(): void {
    this.counters.clear();

    this.trail.length = 0;
    this.counterSamples.length = 0;
  }
}
