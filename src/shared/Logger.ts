import { sink } from './Sink';
import { sanitizeForFileLine } from './textForFile';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type Level = LogLevel;

const COLORS: Record<Level, string> = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};

const BLESS_LEVEL: Record<Level, string> = {
  info: 'cyan-fg',
  warn: 'yellow-fg',
  error: 'red-fg',
  debug: 'gray-fg',
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
  level: LogLevel;
  text: string;
  ts: string;
};

export class LogUiOutlet {
  private fn: ((line: UiLogLine) => void) | null = null;

  public attach(handler: (line: UiLogLine) => void): void {
    this.fn = handler;
  }

  public detach(): void {
    this.fn = null;
  }

  public emit(line: UiLogLine): void {
    if (this.fn === null) return;
    this.fn(line);
  }

  public isAttached(): boolean {
    return this.fn !== null;
  }
}

let installedOutlet = new LogUiOutlet();

export function getLogUiOutlet(): LogUiOutlet {
  return installedOutlet;
}

export function installLogUiOutlet(outlet: LogUiOutlet): void {
  installedOutlet = outlet;
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
    const tag = BLESS_LEVEL[level];
    const uiText = `{${tag}}${head}{/${tag}} ${body}`;

    const outlet = getLogUiOutlet();
    outlet.emit({
      botId: this.botId ?? null,
      level,
      text: uiText,
      ts: iso,
    });

    if (!outlet.isAttached()) {
      CONSOLE[level](`${COLORS[level]}${head}${RESET}`, ...args);
    }

    sink.writeText(sanitizeForFileLine(fullLine));
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
    const suffix = data !== undefined ? `\n${JSON.stringify(data)}` : '';
    this.debug(`decision: ${action} <- ${reason}${suffix}`);

    sink.writeEvent({
      ts: new Date().toISOString(),
      type: 'decision',
      scope: this.prefix,
      botId: this.botId,
      data: { action, reason, ...(data ?? {}) },
    });
  }
}
