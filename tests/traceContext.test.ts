import { describe, expect, test } from 'bun:test';
import { Logger } from '../src/shared/Logger';
import { sink, type SinkEvent } from '../src/shared/Sink';
import { getTraceId, withNavigatorTrace } from '../src/shared/traceContext';

describe('traceContext', () => {
  test('getTraceId is undefined outside trace', (): void => {
    expect(getTraceId()).toBeUndefined();
  });

  test('withNavigatorTrace propagates id through async continuation', async (): Promise<void> => {
    const seen: string[] = [];
    await withNavigatorTrace(async (): Promise<void> => {
      await Promise.resolve();
      const t = getTraceId();
      if (t !== undefined) seen.push(t);
    });
    expect(seen.length).toBe(1);
    expect(seen[0]!.length).toBeGreaterThan(10);
  });
});

describe('Logger trace_id on sink', () => {
  test('event attaches trace_id when inside withNavigatorTrace', async (): Promise<void> => {
    const written: SinkEvent[] = [];
    const orig = sink.writeEvent.bind(sink);
    sink.writeEvent = (ev: SinkEvent): void => {
      written.push(ev);
    };
    try {
      const log = new Logger('t', 'bot-a');
      await withNavigatorTrace(async (): Promise<void> => {
        log.event('nav_test', { x: 1 });
      });
    } finally {
      sink.writeEvent = orig;
    }
    expect(written.length).toBe(1);
    expect(written[0]!.trace_id).toBeDefined();
    expect(written[0]!.botId).toBe('bot-a');
    expect(written[0]!.type).toBe('nav_test');
  });
});
