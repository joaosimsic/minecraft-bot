type Level = 'info' | 'warn' | 'error';

export class Logger {
  constructor(private readonly prefix: string) {}

  private write(level: Level, ...args: unknown[]): void {
    const t = new Date().toISOString().slice(11, 19);

    const logMap: Record<Level, (...args: any[]) => void> = {
      info: console.log,
      warn: console.warn,
      error: console.error,
    };

    const fn = logMap[level];
    fn(`[${t}][${this.prefix}]`, ...args);
  }

  info(...args: unknown[]) {
    this.write('info', ...args);
  }
  warn(...args: unknown[]) {
    this.write('warn', ...args);
  }
  error(...args: unknown[]) {
    this.write('error', ...args);
  }
}
