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

  test('parses trace_id', (): void => {
    const line =
      '{"ts":"t","type":"decision","botId":"b","trace_id":"abc-123","data":{}}';
    const [e, ev] = parseReplayJsonlLine(line);
    expect(e).toBeNull();
    expect(ev?.trace_id).toBe('abc-123');
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

  test('env_update accumulates envTail', (): void => {
    const st = new ReplayState();
    st.applyEvent({
      ts: 't0',
      type: 'spawn',
      botId: 'alice',
    });
    st.applyEvent({
      ts: 't1',
      type: 'env_update',
      botId: 'alice',
      trace_id: 'tid-1',
      data: {
        x: 1,
        y: 2,
        z: 3,
        blockName: 'stone',
        movementClassBefore: 'ground',
        movementClassAfter: 'water',
      },
    });
    const p = st.toPayload(null);
    expect(p.envTail?.length).toBe(1);
    expect(p.envTail![0]!.trace_id).toBe('tid-1');
    expect(p.envTail![0]!.blockName).toBe('stone');
  });

  test('exportSnapshot roundtrips through loadSnapshot', (): void => {
    const st = new ReplayState();
    st.applyEvent({
      ts: 't0',
      type: 'spawn',
      botId: 'alice',
    });
    st.applyEvent({
      ts: 't1',
      type: 'position',
      botId: 'alice',
      data: { pos: { x: 1, y: 2, z: 3 } },
    });
    const snap = st.exportSnapshot();
    const st2 = new ReplayState();
    st2.loadSnapshot(snap);
    const p2 = st2.toPayload(null);
    expect(p2.fleet.length).toBe(1);
    expect(p2.fleet[0]!.positionLabel).toContain('1.0');
  });
});
