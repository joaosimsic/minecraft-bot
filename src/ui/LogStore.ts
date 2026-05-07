import type { LogLevel, UiLogLine } from '../shared/Logger';

const MAX_ALL = 2500;
const MAX_PER_BOT = 1000;
const MAX_SYSTEM = 500;

function cmpTs(a: UiLogLine, b: UiLogLine): number {
  if (a.ts < b.ts) return -1;
  if (a.ts > b.ts) return 1;
  return 0;
}

function mergeByTs(a: UiLogLine[], b: UiLogLine[]): UiLogLine[] {
  let i = 0;
  let j = 0;
  const out: UiLogLine[] = [];
  while (i < a.length && j < b.length) {
    if (cmpTs(a[i]!, b[j]!) <= 0) {
      out.push(a[i]!);
      i += 1;
      continue;
    }
    out.push(b[j]!);
    j += 1;
  }
  while (i < a.length) {
    out.push(a[i]!);
    i += 1;
  }
  while (j < b.length) {
    out.push(b[j]!);
    j += 1;
  }
  return out;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function logLineMatchesDisplayFilters(
  line: UiLogLine,
  filterBotId: string | null,
  minLevel: LogLevel | null,
): boolean {
  if (minLevel !== null && LEVEL_RANK[line.level] < LEVEL_RANK[minLevel])
    return false;

  if (filterBotId === null) return true;

  if (line.botId === null) return true;

  return line.botId === filterBotId;
}

function pushCapped(arr: UiLogLine[], line: UiLogLine, max: number): void {
  arr.push(line);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

export class LogStore {
  private readonly allLines: UiLogLine[] = [];
  private readonly systemLines: UiLogLine[] = [];
  private readonly byBot = new Map<string, UiLogLine[]>();

  public append(line: UiLogLine): void {
    pushCapped(this.allLines, line, MAX_ALL);
    if (line.botId === null) {
      pushCapped(this.systemLines, line, MAX_SYSTEM);
      return;
    }
    const id = line.botId;
    const bucket = this.byBot.get(id);
    if (bucket === undefined) {
      this.byBot.set(id, [line]);
      return;
    }
    pushCapped(bucket, line, MAX_PER_BOT);
  }

  public getRecentBotLines(
    botId: string,
    count: number,
    minLevel: LogLevel | null,
  ): UiLogLine[] {
    const bucket = this.byBot.get(botId) ?? [];
    let lines = bucket;
    if (minLevel !== null) {
      lines = bucket.filter(
        (l): boolean => LEVEL_RANK[l.level] >= LEVEL_RANK[minLevel],
      );
    }
    if (lines.length <= count) return [...lines];
    return lines.slice(lines.length - count);
  }

  public getDisplayLines(
    filterBotId: string | null,
    minLevel: LogLevel | null,
  ): UiLogLine[] {
    let base: UiLogLine[];
    if (filterBotId === null) {
      base = [...this.allLines];
    } else {
      const botBucket = this.byBot.get(filterBotId) ?? [];
      base = mergeByTs(this.systemLines, botBucket);
    }
    if (minLevel === null) return base;
    return base.filter(
      (l): boolean => LEVEL_RANK[l.level] >= LEVEL_RANK[minLevel],
    );
  }
}
