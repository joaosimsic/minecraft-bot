import { sink } from './Sink';

type Level = 'info' | 'warn' | 'error' | 'debug';

const COLORS: Record<Level, string> = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

const CONSOLE: Record<Level, (...a: unknown[]) => void> = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log,
};

export type UiLogLine = {
  botId: string | null;
  level: Level;
  text: string;
  ts: string;
};

let uiLineSink: ((line: UiLogLine) => void) | null = null;

export function setLoggerUiSink(fn: ((line: UiLogLine) => void) | null): void {
  uiLineSink = fn;
}

const fmtArg = (a: unknown): string =>
  typeof a === 'string' ? a : JSON.stringify(a);

export class Logger {
  public constructor(
    private readonly prefix: string,
    private readonly botId?: string,
  ) {}

  private write(level: Level, args: unknown[]): void {
    const iso = new Date().toISOString();
    const idPart = this.botId === undefined ? '' : `[${this.botId}]`;
    const head = `[${iso.slice(11, 23)}][${this.prefix}]${idPart}[${level.toUpperCase()}]`;
    const body = args.map(fmtArg).join(' ');
    const fullLine = `${head} ${body}`;

    if (uiLineSink !== null) {
      uiLineSink({
        botId: this.botId ?? null,
        level,
        text: fullLine,
        ts: iso,
      });
    }

    if (uiLineSink === null) {
      CONSOLE[level](`${COLORS[level]}${head}${RESET}`, ...args);
    }

    sink.writeText(fullLine);
  }

  public info(...args: unknown[]): void {
    this.write('info', args);
  }
  public warn(...args: unknown[]): void {
    this.write('warn', args);
  }
  public error(...args: unknown[]): void {
    this.write('error', args);
  }
  public debug(...args: unknown[]): void {
    this.write('debug', args);
  }

  public event(type: string, data?: Record<string, unknown>): void {
    sink.writeEvent({
      ts: new Date().toISOString(),
      type,
      scope: this.prefix,
      botId: this.botId,
      data,
    });
  }

  public decision(
    action: string,
    reason: string,
    data?: Record<string, unknown>,
  ): void {
    this.debug(`decision: ${action} <- ${reason}`, data ?? '');
    sink.writeEvent({
      ts: new Date().toISOString(),
      type: 'decision',
      scope: this.prefix,
      botId: this.botId,
      data: { action, reason, ...(data ?? {}) },
    });
  }
}
