import { z } from 'zod';
import type { SinkEvent } from '../shared/Sink';
import type { LogLevel, UiLogLine } from '../shared/Logger';

const eventSchema = z.object({
  ts: z.string(),
  type: z.string(),
  scope: z.string().optional(),
  botId: z.string().optional(),
  trace_id: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const BLESS_LEVEL: Record<LogLevel, string> = {
  info: 'cyan-fg',
  warn: 'yellow-fg',
  error: 'red-fg',
  debug: 'gray-fg',
};

export function jsonParseLine(raw: string): [Error | null, unknown | null] {
  try {
    return [null, JSON.parse(raw)];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return [new Error(msg), null];
  }
}

export function parseReplayJsonlLine(
  line: string,
): [Error | null, SinkEvent | null] {
  const trimmed = line.trim();
  if (trimmed.length === 0) return [null, null];
  const [je, raw] = jsonParseLine(trimmed);
  if (je !== null) return [je, null];
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return [new Error('invalid event shape'), null];
  const d = parsed.data;
  const out: SinkEvent = {
    ts: d.ts,
    type: d.type,
    scope: d.scope,
    botId: d.botId,
    data: d.data,
  };
  if (d.trace_id !== undefined) out.trace_id = d.trace_id;
  return [null, out];
}

function logLevelForEventType(t: string): LogLevel {
  if (t === 'bot_error') return 'error';
  if (t === 'kicked') return 'error';
  if (t === 'death') return 'warn';
  if (t === 'decision') return 'debug';
  return 'info';
}

export function sinkEventToUiLogLine(ev: SinkEvent): UiLogLine {
  const ts = ev.ts;
  const botId = ev.botId ?? null;
  const sc = ev.scope === undefined ? '' : `[${ev.scope}]`;
  const dataStr = ev.data === undefined ? '' : ` ${JSON.stringify(ev.data)}`;
  const headSlice =
    ts.length >= 23 ? ts.slice(11, 23) : ts.slice(Math.max(0, ts.length - 12));
  const head = `[${headSlice}][${ev.type}]${sc}`;
  const level = logLevelForEventType(ev.type);
  const tag = BLESS_LEVEL[level];
  const text = `{${tag}}${head}{/${tag}}${dataStr}`;
  return { botId, level, text, ts };
}
