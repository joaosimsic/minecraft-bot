import { existsSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { config } from '../config';
import { Logger } from '../shared/Logger';
import type { AsyncResult, Result } from '../shared/result';
import { okVoid } from '../shared/result';

const JAR_VER = config.env.VIAPROXY_VERSION;
const JAR_NAME = `ViaProxy-${JAR_VER}.jar`;
const PROXY_DIR = join(process.cwd(), '.viaproxy');
const JAR_PATH = join(PROXY_DIR, JAR_NAME);
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

const stripAnsi = (s: string): string => s.replace(ANSI_ESCAPE, '');

export class ViaProxy {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private readonly log = new Logger('viaproxy');

  private static pumpStream(
    stream: ReadableStream<Uint8Array> | undefined,
    log: Logger,
  ): void {
    if (stream === undefined) return;

    void (async (): Promise<void> => {
      const reader = stream.getReader();
      const dec = new TextDecoder();
      let buf = '';

      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';

        for (const raw of parts) {
          const line = stripAnsi(raw.replace(/\r$/, '')).trimEnd();
          if (line.length === 0) continue;
          log.info(line);
        }
      }

      if (buf.length === 0) return;

      const line = stripAnsi(buf.replace(/\r$/, '')).trimEnd();
      if (line.length === 0) return;

      log.info(line);
    })().catch((): void => undefined);
  }

  constructor(
    private readonly opts: {
      bindPort: number;
      targetHost: string;
      targetPort: number;
      targetVersion: string;
    },
  ) {}

  public static needsProxy(version: string): boolean {
    return /^(b|a|c)\d|(beta|alpha|classic)/i.test(version);
  }

  private async checkJava(): AsyncResult<null> {
    const proc = Bun.spawn(['java', '-version'], {
      stderr: 'ignore',
      stdout: 'ignore',
    });

    await proc.exited;

    if (proc.exitCode !== 0)
      return [new Error('java not found in PATH. Install JRE 17+'), null];

    return okVoid();
  }

  private async ensureJar(): AsyncResult<null> {
    if (existsSync(JAR_PATH)) {
      this.log.info('jar present', JAR_PATH);
      return okVoid();
    }

    if (!existsSync(PROXY_DIR)) mkdirSync(PROXY_DIR, { recursive: true });

    const url = `https://github.com/ViaVersion/ViaProxy/releases/download/v${JAR_VER}/${JAR_NAME}`;
    this.log.info('downloading', url);

    const proc = Bun.spawn(['curl', '-fsSL', '-o', JAR_PATH, url], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    await proc.exited;

    if (proc.exitCode !== 0)
      return [new Error(`download failed: curl exited ${proc.exitCode}`), null];

    this.log.info('downloaded', JAR_PATH);
    return okVoid();
  }

  private async waitForPort(timeoutMs = 60000): AsyncResult<null> {
    const { bindPort } = this.opts;
    const start = Date.now();
    let lastErrMsg: string | null = null;

    while (Date.now() - start < timeoutMs) {
      const ok = await new Promise<boolean>((resolve) => {
        const s = connect({ port: bindPort, host: '127.0.0.1' });

        s.once('connect', () => {
          s.end();
          resolve(true);
        });

        s.once('error', (err: Error) => {
          lastErrMsg = err.message;
          resolve(false);
        });
      });

      if (ok) return okVoid();

      await Bun.sleep(500);
    }

    return [
      new Error(
        `port ${bindPort} not open after ${timeoutMs}ms (last: ${lastErrMsg})`,
      ),
      null,
    ];
  }

  public async start(): AsyncResult<null> {
    const [e0] = await this.checkJava();
    if (e0) return [e0, null];

    const [e1] = await this.ensureJar();
    if (e1) return [e1, null];

    const { bindPort, targetHost, targetPort, targetVersion } = this.opts;

    const args = [
      '--bind-address',
      `0.0.0.0:${bindPort}`,
      '--target-address',
      `${targetHost}:${targetPort}`,
      '--target-version',
      targetVersion,
      '--auth-method',
      'NONE',
    ];

    this.log.info('spawning java', args.slice(2).join(' '));

    this.proc = Bun.spawn(['java', '-jar', JAR_PATH, 'cli', ...args], {
      cwd: PROXY_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    ViaProxy.pumpStream(this.proc.stdout, this.log);
    ViaProxy.pumpStream(this.proc.stderr, this.log);

    void this.proc.exited.then(() => {
      this.log.info('exited code', this.proc?.exitCode);
    });

    const portReady = this.waitForPort();

    const earlyExit: Promise<Result<null>> = this.proc.exited.then(
      (): Result<null> => [
        new Error('viaproxy exited before port opened; check java logs'),
        null,
      ],
    );

    const raced = await Promise.race([portReady, earlyExit]);
    const [e2] = raced;

    if (e2) return [e2, null];

    return okVoid();
  }

  public stop(): void {
    if (!this.proc) return;

    if (this.proc.exitCode === null) this.proc.kill();

    this.proc = null;
  }
}
