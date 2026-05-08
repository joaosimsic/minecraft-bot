import { config } from '../config';
import type { Metrics } from './Metrics';
import { wrap } from './result';
import { buildOtlpMetricsIngestUrl } from './debugLog';

function nowUnixNanos(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

function attrString(key: string, value: string): Record<string, unknown> {
  return { key, value: { stringValue: value } };
}

function gaugePoint(
  value: number,
  attrs: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    asDouble: value,
    timeUnixNano: nowUnixNanos(),
    attributes: attrs,
  };
}

function sumPointCumulative(
  value: number,
  attrs: Record<string, unknown>[],
): Record<string, unknown> {
  const t = nowUnixNanos();
  return {
    asDouble: value,
    startTimeUnixNano: t,
    timeUnixNano: t,
    attributes: attrs,
  };
}

function buildMetricsPayload(
  botId: string,
  mode: string,
  blocksPerMin: number,
  distancePerMin: number,
  blocksDugTotal: number,
  distanceWalkedTotal: number,
  uptimeSec: number,
): Record<string, unknown> {
  const service = config.env.TELEMETRY_SERVICE_NAME;
  const modeAttr = [attrString('mode', mode)];

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            attrString('service.name', service),
            attrString('bot_id', botId),
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'minecraft-bot-metrics', version: '1' },
            metrics: [
              {
                name: 'bot.blocks_dug_per_minute',
                description: 'Blocks dug in trailing 60s window',
                gauge: {
                  dataPoints: [gaugePoint(blocksPerMin, modeAttr)],
                },
              },
              {
                name: 'bot.horizontal_distance_per_minute',
                description:
                  'Distance walked delta in trailing 60s window (blocks/min)',
                gauge: {
                  dataPoints: [gaugePoint(distancePerMin, modeAttr)],
                },
              },
              {
                name: 'bot.blocks_dug_total',
                description: 'Cumulative blocks dug',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [sumPointCumulative(blocksDugTotal, modeAttr)],
                },
              },
              {
                name: 'bot.distance_walked_total',
                description: 'Cumulative distance walked',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    sumPointCumulative(distanceWalkedTotal, modeAttr),
                  ],
                },
              },
              {
                name: 'bot.uptime_seconds',
                description: 'Bot process uptime',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [sumPointCumulative(uptimeSec, modeAttr)],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postMetricsJson(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
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

export class MetricsExporter {
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly botId: string,
    private readonly metrics: Metrics,
  ) {}

  public start(): void {
    const base = config.env.TELEMETRY_ENDPOINT;
    if (base === undefined) return;
    const ms = config.env.TELEMETRY_METRICS_EXPORT_MS;
    this.timer = setInterval((): void => {
      void this.tick(base);
    }, ms);
  }

  public stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(base: string): Promise<void> {
    this.metrics.ingestSampleForWindow();
    const winMs = 60_000;
    const keys = ['blocks.dug', 'distance_walked'];
    const d = this.metrics.windowCounterDelta(keys, winMs);
    const blocksDelta = d['blocks.dug'] ?? 0;
    const distDelta = d['distance_walked'] ?? 0;
    const blocksPerMin = blocksDelta;
    const distancePerMin = distDelta;
    const snap = this.metrics.summary();
    const blocksTotal = snap.counters['blocks.dug'] ?? 0;
    const distTotal = snap.counters['distance_walked'] ?? 0;
    const uptimeSec = snap.uptimeMs / 1000;
    const body = buildMetricsPayload(
      this.botId,
      config.env.MODE,
      blocksPerMin,
      distancePerMin,
      blocksTotal,
      distTotal,
      uptimeSec,
    );
    await postMetricsJson(buildOtlpMetricsIngestUrl(base), body);
  }
}
