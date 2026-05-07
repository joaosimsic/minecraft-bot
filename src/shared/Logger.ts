import { sink } from './Sink';

type Level = 'info' | 'warn' | 'error' | 'debug';

const COLORS: Record<Level, string> = {
  info:  '\x1b[36m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

const CONSOLE: Record<Level, (...a: unknown[]) => void> = {
  info:  console.log,
  warn:  console.warn,
  error: console.error,
  debug: console.log,
};

const fmtArg = (a: unknown): string =>
  typeof a === 'string' ? a : JSON.stringify(a);

export class Logger {
  public constructor(private readonly prefix: string) {}

  private write(level: Level, args: unknown[]): void {
    const iso = new Date().toISOString();
    const head = `[${iso.slice(11, 23)}][${this.prefix}][${level.toUpperCase()}]`;
    const body = args.map(fmtArg).join(' ');

    CONSOLE[level](`${COLORS[level]}${head}${RESET}`, ...args);
    sink.writeText(`${head} ${body}`);
  }

  public info(...args: unknown[]): void  { this.write('info', args); }
  public warn(...args: unknown[]): void  { this.write('warn', args); }
  public error(...args: unknown[]): void { this.write('error', args); }
  public debug(...args: unknown[]): void { this.write('debug', args); }

  public event(type: string, data?: Record<string, unknown>): void {
    sink.writeEvent({
      ts: new Date().toISOString(),
      type,
      scope: this.prefix,
      data,
    });
  }

  public decision(action: string, reason: string, data?: Record<string, unknown>): void {
    this.debug(`decision: ${action} <- ${reason}`, data ?? '');
    sink.writeEvent({
      ts: new Date().toISOString(),
      type: 'decision',
      scope: this.prefix,
      data: { action, reason, ...(data ?? {}) },
    });
  }
}
