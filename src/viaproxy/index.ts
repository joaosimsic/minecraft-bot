import { existsSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { Logger } from '../Logger';
import { JAR_NAME, JAR_VER, JAR_PATH, PROXY_DIR } from './constants';

export class ViaProxy {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private readonly log = new Logger('viaproxy');

  constructor(
    private readonly opts: {
      bindPort: number;
      targetHost: string;
      targetPort: number;
      targetVersion: string;
    },
  ) {}

  static needsProxy(version: string): boolean {
    return /^(b|a|c)\d|(beta|alpha|classic)/i.test(version);
  }

  private async checkJava(): Promise<void> {
    const proc = Bun.spawn(['java', '-version'], {
      stderr: 'ignore',
      stdout: 'ignore',
    });

    await proc.exited;

    if (proc.exitCode !== 0)
      throw new Error('java not found in PATH. Install JRE 17+.');
  }

  private async ensureJar(): Promise<void> {
    if (existsSync(JAR_PATH)) {
      this.log.info('jar present', JAR_PATH);
      return;
    }

    if (!existsSync(PROXY_DIR)) mkdirSync(PROXY_DIR, { recursive: true });

    const url = `https://github.com/ViaVersion/ViaProxy/releases/download/v${JAR_VER}/${JAR_NAME}`;

    this.log.info('downloading', url);

    const res = await fetch(url);

    if (!res.ok) throw new Error(`download failed: ${res.status}`);

    await Bun.write(JAR_PATH, res);

    this.log.info('downloaded', JAR_PATH);
  }

  private async waitForPort(timeoutMs = 60000): Promise<void> {
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

        s.once('error', (err) => {
          lastErrMsg = err.message;
          resolve(false);
        });
      });
      if (ok) return;

      await Bun.sleep(500);
    }
    throw new Error(
      `port ${bindPort} not open after ${timeoutMs}ms (last: ${lastErrMsg})`,
    );
  }

  public async start(): Promise<void> {
    await this.checkJava();
    await this.ensureJar();

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

    this.proc = Bun.spawn(['java', ...args], {
      cwd: PROXY_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    });

    let exited = false;

    this.proc.exited.then(() => {
      exited = true;
      this.log.info('exited code', this.proc?.exitCode);
    });

    const portReady = this.waitForPort();

    const earlyExit = this.proc.exited.then(() => {
      throw new Error('viaproxy exited before port opened; check java logs');
    });

    await Promise.race([portReady, earlyExit]);
  }

  public stop(): void {
    if (!this.proc) return;

    if (this.proc.exitCode === null) this.proc.kill();

    this.proc = null;
  }
}
