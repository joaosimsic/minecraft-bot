import { describe, expect, test } from 'bun:test';
import {
  buildOrderedPaletteCandidates,
  rankPaletteCandidates,
  scorePaletteMatch,
} from '../src/ui/paletteRank';

describe('buildOrderedPaletteCandidates', (): void => {
  test('orders ids and includes @ forms', (): void => {
    const rows = buildOrderedPaletteCandidates(['bob', 'alice']);
    expect(rows.includes('auto')).toBe(true);
    expect(rows.includes('@all')).toBe(true);
    expect(rows.includes('@alice')).toBe(true);
    expect(rows.includes('@bob')).toBe(true);
    expect(rows.includes('alice')).toBe(true);
    expect(rows.includes('bob')).toBe(true);
    const ai = rows.indexOf('@alice');
    const bi = rows.indexOf('@bob');
    expect(ai).toBeLessThan(bi);
  });
  test('includes :run for each macro name', (): void => {
    const rows = buildOrderedPaletteCandidates(['a'], ['z', 'y']);
    expect(rows.includes(':run y')).toBe(true);
    expect(rows.includes(':run z')).toBe(true);
    const yi = rows.indexOf(':run y');
    const zi = rows.indexOf(':run z');
    expect(yi).toBeLessThan(zi);
  });
});

describe('scorePaletteMatch', (): void => {
  test('returns null for empty query', (): void => {
    expect(scorePaletteMatch('', 'auto')).toBeNull();
  });

  test('substring beats loose subsequence', (): void => {
    const exact = scorePaletteMatch('ping', 'ping');
    const loose = scorePaletteMatch('ping', 'shopping');
    expect(exact).not.toBeNull();
    expect(loose).not.toBeNull();
    if (exact === null || loose === null) return;
    expect(exact.score).toBeGreaterThan(loose.score);
  });
});

describe('rankPaletteCandidates', (): void => {
  test('empty query preserves command-first slice', (): void => {
    const ord = buildOrderedPaletteCandidates([]);
    const ranked = rankPaletteCandidates('', ord);
    expect(ranked[0]).toBe('auto');
  });

  test('subsequence finds scattered letters', (): void => {
    const ord = ['auto', 'guided'];
    const ranked = rankPaletteCandidates('ato', ord);
    expect(ranked[0]).toBe('auto');
  });

  test('filters non-matches', (): void => {
    const ord = ['ping', 'stop'];
    const ranked = rankPaletteCandidates('zzz', ord);
    expect(ranked.length).toBe(0);
  });
});
