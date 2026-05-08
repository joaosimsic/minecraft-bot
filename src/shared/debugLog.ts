import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { wrap } from './result';
import { getTraceId } from './traceContext';

function otlpTraceId(): string {
  const t = getTraceId();
  if (t !== undefined) {
    const h = t.replace(/-/g, '').toLowerCase();
    if (h.length >= 32) return h.slice(0, 32);
    return h.padStart(32, '0').slice(0, 32);
  }
  return randomBytes(16).toString('hex');
}

function otlpSpanId(): string {
  return randomBytes(8).toString('hex');
}

function nowUnixNanos(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

export function buildOtlpTracesIngestUrl(raw: string): string {
  let u = raw.trim();
  while (u.endsWith('/')) u = u.slice(0, -1);
  const tail = '/v1/traces';
  if (u.toLowerCase().endsWith(tail)) u = u.slice(0, u.length - tail.length);
  while (u.endsWith('/')) u = u.slice(0, -1);
  return `${u}${tail}`;
}

export function buildOtlpMetricsIngestUrl(raw: string): string {
  let u = raw.trim();
  while (u.endsWith('/')) u = u.slice(0, -1);
  const tail = '/v1/metrics';
  if (u.toLowerCase().endsWith(tail)) u = u.slice(0, u.length - tail.length);
  while (u.endsWith('/')) u = u.slice(0, -1);
  return `${u}${tail}`;
}

function attrString(key: string, value: string): Record<string, unknown> {
  return { key, value: { stringValue: value } };
}

function buildOtlpTracePayload(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): Record<string, unknown> {
  const service = config.env.TELEMETRY_SERVICE_NAME;
  const session = config.env.TELEMETRY_SESSION_ID;
  const attrs: Record<string, unknown>[] = [
    attrString('location', location),
    attrString('message', message),
    attrString('hypothesis_id', hypothesisId),
    attrString('data.json', JSON.stringify(data)),
  ];
  if (session !== undefined) attrs.push(attrString('session.id', session));

  const traceId = otlpTraceId();
  const spanId = otlpSpanId();
  const t0 = nowUnixNanos();

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [attrString('service.name', service)],
        },
        scopeSpans: [
          {
            scope: { name: 'minecraft-bot-debug', version: '1' },
            spans: [
              {
                traceId,
                spanId,
                name: location,
                kind: 1,
                startTimeUnixNano: t0,
                endTimeUnixNano: t0,
                attributes: attrs,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postTelemetry(
  url: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): Promise<void> {
  const body = buildOtlpTracePayload(location, message, data, hypothesisId);
  const [err, res] = await wrap(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  if (err !== null) return;
  if (res === null) return;
  if (!res.ok) return;
}

export function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  const base = config.env.TELEMETRY_ENDPOINT;
  if (base === undefined) return;
  void postTelemetry(
    buildOtlpTracesIngestUrl(base),
    location,
    message,
    data,
    hypothesisId,
  );
}
