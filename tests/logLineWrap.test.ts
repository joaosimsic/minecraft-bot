import { describe, expect, test } from 'bun:test';
import {
  logInnerDisplayWidth,
  visibleLenOf,
  wrapUiLogLine,
} from '../src/ui/logLineWrap';

describe('logInnerDisplayWidth', () => {
  test('subtracts iwidth and optional scrollbar column', () => {
    expect(
      logInnerDisplayWidth({ width: 100, iwidth: 2, scrollbar: { ch: ' ' } }),
    ).toBe(97);
    expect(logInnerDisplayWidth({ width: 100, iwidth: 2 })).toBe(98);
  });
});

describe('wrapUiLogLine', () => {
  test('leaves short bot-tagged lines as one row', () => {
    const line = '[x] {cyan-fg}h{/cyan-fg} short';
    expect(wrapUiLogLine(line, 80)).toEqual([line]);
  });

  test('continuation rows are flush left (no header indent)', () => {
    const head = 'H';
    const idle = `[M] {gray-fg}${head}{/gray-fg} `;
    const body =
      'one two three four five six seven eight nine ten eleven twelve thirteen';
    const got = wrapUiLogLine(idle + body, 28);
    expect(got.length).toBeGreaterThan(1);
    for (let i = 1; i < got.length; i += 1) {
      const row = got[i];
      expect(row).toBeDefined();
      expect(row?.startsWith(' ')).toBe(false);
    }
  });

  test('each wrapped row fits blessed visible width budget', () => {
    const line = `[Miner] {gray-fg}HH{/gray-fg} ` + 'x'.repeat(200);
    const inner = 56;
    const got = wrapUiLogLine(line, inner);
    for (const row of got) {
      expect(visibleLenOf(row)).toBeLessThanOrEqual(inner);
    }
  });

  test('first line uses full visible width when body has no spaces', () => {
    const prefix = '[Bot] {cyan-fg}[ts][Mod][Bot][INFO]{/cyan-fg} ';
    const body = 'x'.repeat(200);
    const inner = 80;
    const got = wrapUiLogLine(prefix + body, inner);
    expect(visibleLenOf(got[0]!)).toBe(inner);
  });

  test('hard-breaks long runs without spaces in body', () => {
    const line = `[M] {gray-fg}H{/gray-fg} ` + 'z'.repeat(80);
    const got = wrapUiLogLine(line, 24);
    expect(got.length).toBeGreaterThan(2);
    expect((got.join('').match(/z/g) ?? []).length).toBe(80);
  });

  test('embedded newlines: continuations have no leading whitespace', () => {
    const line =
      '[—] {cyan-fg}[ts][pfx][INFO]{/cyan-fg} first\n  indented second\n   indented third';
    const got = wrapUiLogLine(line, 80);
    expect(got.length).toBe(3);
    expect(got[0]).toContain('first');
    expect(got[1]).toBe('indented second');
    expect(got[2]).toBe('indented third');
  });

  test('embedded newlines: empty sub-lines are skipped', () => {
    const line = '[x] {gray-fg}H{/gray-fg} body\n\n  tail';
    const got = wrapUiLogLine(line, 80);
    expect(got.length).toBe(2);
    expect(got[0]).toContain('body');
    expect(got[1]).toBe('tail');
  });

  test('wraps head-only tagged lines for multi-column text', () => {
    const line =
      '{gray-fg}HH{/gray-fg} ' +
      'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv';
    const got = wrapUiLogLine(line, 18);
    expect(got.length).toBeGreaterThan(1);
    expect(got[0]).toContain('{gray-fg}');
  });
});
