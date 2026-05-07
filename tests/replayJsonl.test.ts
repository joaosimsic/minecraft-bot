import { describe, expect, test } from 'bun:test';
import {
  parseReplayJsonlLine,
  sinkEventToUiLogLine,
} from '../src/replay/replayJsonl';
import { ReplayState } from '../src/replay/ReplayState';
import type { SinkEvent } from '../src/shared/Sink';

describe('parseReplayJsonlLine', (): void => {
  test('empty line', (): void => {
    const [e, ev] = parseReplayJsonlLine('  ');
    expect(e).toBeNull();
    expect(ev).toBeNull();
  });

  test('valid event', (): void => {
    const [e, ev] = parseReplayJsonlLine(
      '{"ts":"2026-01-01T00:00:00.000Z","type":"spawn","botId":"a"}',
    );
    expect(e).toBeNull();
    expect(ev).toEqual({
      ts: '2026-01-01T00:00:00.000Z',
      type: 'spawn',
      botId: 'a',
    });
  });

  test('invalid json', (): void => {
    const [e, ev] = parseReplayJsonlLine('{');
    expect(e).not.toBeNull();
    expect(ev).toBeNull();
  });
});

describe('sinkEventToUiLogLine', (): void => {
  test('error level for bot_error', (): void => {
    const ev: SinkEvent = {
      ts: '2026-01-01T12:34:56.789Z',
      type: 'bot_error',
      botId: 'x',
      data: { msg: 'oops' },
    };
    const line = sinkEventToUiLogLine(ev);
    expect(line.level).toBe('error');
    expect(line.botId).toBe('x');
    expect(line.text.includes('red')).toBe(true);
  });
});

describe('ReplayState', (): void => {
  test('spawn and position update fleet payload', (): void => {
    const st = new ReplayState();
    const a: SinkEvent = {
      ts: 't0',
      type: 'spawn',
      botId: 'alice',
    };
    const b: SinkEvent = {
      ts: 't1',
      type: 'position',
      botId: 'alice',
      data: { pos: { x: 10, y: 64, z: -3 } },
    };
    st.applyEvent(a);
    st.applyEvent(b);
    const p = st.toPayload({ x: 0, z: 0 });
    expect(p.fleet.length).toBe(1);
    expect(p.fleet[0]!.positionLabel).toContain('10.0');
    expect(p.fleet[0]!.online).toBe(true);
  });
});
