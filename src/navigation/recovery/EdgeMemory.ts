import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import type { NodeKey } from '../planner/Node';
import { SearchEdge } from '../planner/Edge';
import type { ActionKind } from '../movement/Actions';

const PENALTY_BUMP = 5;
const MAX_LEARNED_ADD = 40;
const HALF_LIFE_TICKS = 200;
const DECAY_PER_HALF_LIFE = 0.5;

export type EdgeMemoryOptions = {
  persistPath?: string;
  maxEntries?: number;
  saveEveryFailures?: number;
};

type EdgeRow = {
  failureCount: number;
  learnedAdd: number;
  lastFailureTick: number;
  lastDecayTick: number;
};

type PersistPayload = {
  v: 1;
  rows: Array<EdgeRow & { id: string }>;
};

export class EdgeMemory {
  private readonly rows = new Map<string, EdgeRow>();
  private readonly persistPath?: string;
  private readonly maxEntries: number;
  private readonly saveEveryFailures: number;
  private failuresSinceSave = 0;

  public constructor(opts?: EdgeMemoryOptions) {
    this.persistPath = opts?.persistPath;
    const maxEntries = opts?.maxEntries ?? 4000;
    const saveEvery = opts?.saveEveryFailures ?? 10;
    this.maxEntries = maxEntries;
    this.saveEveryFailures = saveEvery > 0 ? saveEvery : 10;
    this.loadQuiet();
  }

  public recordFailure(
    fromKey: NodeKey,
    toKey: NodeKey,
    kind: ActionKind,
    tick: number,
  ): EdgeRow {
    const id = SearchEdge.stableId(fromKey, toKey, kind);
    const prev = this.rows.get(id);
    if (prev === undefined) {
      const row: EdgeRow = {
        failureCount: 1,
        learnedAdd: PENALTY_BUMP,
        lastFailureTick: tick,
        lastDecayTick: tick,
      };
      this.rows.set(id, row);
      this.schedulePersistMaybe();
      return row;
    }

    this.applyDecayForRow(prev, tick);
    prev.failureCount += 1;
    prev.learnedAdd = Math.min(prev.learnedAdd + PENALTY_BUMP, MAX_LEARNED_ADD);
    prev.lastFailureTick = tick;
    this.schedulePersistMaybe();
    return prev;
  }

  public costWithMemory(
    fromKey: NodeKey,
    toKey: NodeKey,
    kind: ActionKind,
    baseCost: number,
    tick: number,
  ): number {
    const id = SearchEdge.stableId(fromKey, toKey, kind);
    const row = this.rows.get(id);
    if (row === undefined) return baseCost;
    this.applyDecayForRow(row, tick);
    return baseCost + row.learnedAdd;
  }

  public snapshotRow(
    fromKey: NodeKey,
    toKey: NodeKey,
    kind: ActionKind,
    tick: number,
  ): EdgeRow | null {
    const id = SearchEdge.stableId(fromKey, toKey, kind);
    const row = this.rows.get(id);
    if (row === undefined) return null;
    this.applyDecayForRow(row, tick);
    return row;
  }

  public tickDecay(currentTick: number): void {
    for (const row of this.rows.values())
      this.applyDecayForRow(row, currentTick);
  }

  public persistSyncQuiet(): Result<null> {
    return this.persistToDiskInternal();
  }

  private static parseJson(raw: string): Result<unknown> {
    try {
      return ok(JSON.parse(raw) as unknown);
    } catch (err: unknown) {
      if (err instanceof Error) return fail(err);
      return fail(new Error('edge_memory_parse'));
    }
  }

  private static readFileSafe(path: string): Result<string> {
    try {
      return ok(readFileSync(path, 'utf8'));
    } catch (err: unknown) {
      if (err instanceof Error) return fail(err);
      return fail(new Error('edge_memory_read'));
    }
  }

  private static writeFileSafe(path: string, body: string): Result<null> {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, 'utf8');
      return ok(null);
    } catch (err: unknown) {
      if (err instanceof Error) return fail(err);
      return fail(new Error('edge_memory_write'));
    }
  }

  private schedulePersistMaybe(): void {
    if (this.persistPath === undefined) return;

    this.failuresSinceSave += 1;
    if (this.failuresSinceSave < this.saveEveryFailures) return;
    this.failuresSinceSave = 0;
    this.persistSyncQuiet();
    return;
  }

  private loadQuiet(): void {
    if (this.persistPath === undefined) return;
    if (!existsSync(this.persistPath)) return;

    const [readErr, raw] = EdgeMemory.readFileSafe(this.persistPath);
    if (readErr) return;
    if (raw === null) return;

    const [parseErr, parsed] = EdgeMemory.parseJson(raw);
    if (parseErr) return;
    if (parsed === null) return;

    const payload = parsed as PersistPayload | null;
    if (payload?.v !== 1) return;
    if (!Array.isArray(payload.rows)) return;

    this.rows.clear();
    for (const entry of payload.rows) {
      if (typeof entry.id !== 'string') continue;

      const row: EdgeRow = {
        failureCount: entry.failureCount,
        learnedAdd: entry.learnedAdd,
        lastFailureTick: entry.lastFailureTick,
        lastDecayTick: entry.lastDecayTick,
      };

      if (!Number.isFinite(row.failureCount)) continue;

      if (!Number.isFinite(row.learnedAdd)) continue;

      if (!Number.isFinite(row.lastFailureTick)) continue;

      if (!Number.isFinite(row.lastDecayTick)) continue;

      this.rows.set(entry.id, row);
    }
  }

  private persistToDiskInternal(): Result<null> {
    if (this.persistPath === undefined) return ok(null);

    const entries = [...this.rows.entries()];
    entries.sort((a, b): number => {
      const db = b[1].lastFailureTick - a[1].lastFailureTick;
      if (db !== 0) return db;
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });

    const cappedPairs =
      entries.length > this.maxEntries
        ? entries.slice(0, this.maxEntries)
        : entries;

    const payload: PersistPayload = {
      v: 1,
      rows: cappedPairs.map(([id, row]): EdgeRow & { id: string } => ({
        id,
        ...row,
      })),
    };

    const [writeErr] = EdgeMemory.writeFileSafe(
      this.persistPath,
      JSON.stringify(payload),
    );
    if (writeErr) return fail(writeErr);

    if (entries.length <= this.maxEntries) return ok(null);

    this.rows.clear();
    for (const [id, row] of cappedPairs) this.rows.set(id, row);
    return ok(null);
  }

  private applyDecayForRow(row: EdgeRow, tick: number): void {
    if (tick < row.lastDecayTick) return;
    const dt = tick - row.lastDecayTick;
    if (dt === 0) return;
    const factor = Math.pow(DECAY_PER_HALF_LIFE, dt / HALF_LIFE_TICKS);
    row.learnedAdd *= factor;
    row.lastDecayTick = tick;
  }
}
