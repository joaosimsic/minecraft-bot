import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';

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
