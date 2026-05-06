type Level = 'info' | 'warn' | 'error';

const COLORS: Record<Level, string> = {
  info:  '\x1b[36m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

export class Logger {
  constructor(private readonly prefix: string) {}

  private write(level: Level, ...args: unknown[]): void {
    const t = new Date().toISOString().slice(11, 19);
    const color = COLORS[level];

    const logMap: Record<Level, (...args: unknown[]) => void> = {
      info:  console.log,
      warn:  console.warn,
      error: console.error,
    };

    const fn = logMap[level];
    fn(`${color}[${t}][${this.prefix}][${level.toUpperCase()}]${RESET}`, ...args);
  }

  public info(...args: unknown[]): void {
    this.write('info', ...args);
  }
  public warn(...args: unknown[]): void {
    this.write('warn', ...args);
  }
  public error(...args: unknown[]): void {
    this.write('error', ...args);
  }
}
