import { describe, expect, test } from 'bun:test';
import { LogStore } from '../src/ui/LogStore';
import type { UiLogLine } from '../src/shared/Logger';

function line(
  botId: string | null,
  level: UiLogLine['level'],
  text: string,
  ts: string,
): UiLogLine {
  return { botId, level, text, ts };
}

describe('LogStore.getRecentBotLines', () => {
  test('returns last N lines in order', () => {
    const s = new LogStore();
    for (let i = 0; i < 5; i += 1) {
      s.append(line('a', 'info', `m${i}`, `2020-01-0${i + 1}T00:00:00.000Z`));
    }
    const got = s.getRecentBotLines('a', 3, null);
    expect(got.map((x): string => x.text)).toEqual(['m2', 'm3', 'm4']);
  });

  test('respects minimum level', () => {
    const s = new LogStore();
    s.append(line('b', 'info', 'i', '2020-01-01T00:00:00.000Z'));
    s.append(line('b', 'warn', 'w', '2020-01-02T00:00:00.000Z'));
    s.append(line('b', 'error', 'e', '2020-01-03T00:00:00.000Z'));
    const got = s.getRecentBotLines('b', 10, 'warn');
    expect(got.map((x): string => x.text)).toEqual(['w', 'e']);
  });

  test('empty bucket', () => {
    const s = new LogStore();
    expect(s.getRecentBotLines('x', 5, null)).toEqual([]);
  });
});
