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

class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly trail: PosSample[] = [];
  private readonly maxTrail: number = 500;
  private readonly startedAt: number = Date.now();

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
    const last = this.trail.length > 0 ? this.trail[this.trail.length - 1]! : null;
    return {
      uptimeMs: this.uptimeMs(),
      counters: Object.fromEntries(this.counters),
      trailLen: this.trail.length,
      lastPos: last,
    };
  }

  public trailDump(): PosSample[] {
    return this.trail.slice();
  }

  public reset(): void {
    this.counters.clear();
    this.trail.length = 0;
  }
}

export const metrics = new Metrics();
