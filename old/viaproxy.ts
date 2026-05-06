import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';
import { log } from './log';

const JAR_VER = process.env.VIAPROXY_VERSION ?? '3.4.11';
const JAR_NAME = `ViaProxy-${JAR_VER}.jar`;
const VIA_DIR = join(process.cwd(), '.viaproxy');
const JAR_PATH = join(VIA_DIR, JAR_NAME);

export function needsProxy(version: string): boolean {
  return /^(b|a|c)\d/i.test(version) || /(beta|alpha|classic)/i.test(version);
}

async function ensureJar(): Promise<void> {
  if (existsSync(JAR_PATH)) {
    log('viaproxy: jar present', JAR_PATH);
    return;
  }
  if (!existsSync(VIA_DIR)) mkdirSync(VIA_DIR, { recursive: true });
  const url = `https://github.com/ViaVersion/ViaProxy/releases/download/v${JAR_VER}/${JAR_NAME}`;
  log('viaproxy: downloading', url);
  const proc = Bun.spawn(['curl', '-fsSL', '-o', JAR_PATH, url], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;
  if (proc.exitCode !== 0 || !existsSync(JAR_PATH)) {
    throw new Error(`viaproxy: curl download failed (exit ${proc.exitCode})`);
  }
  log('viaproxy: downloaded', JAR_PATH);
}

async function checkJava(): Promise<void> {
  const proc = Bun.spawn(['java', '-version'], { stderr: 'pipe', stdout: 'pipe' });
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error('java not found in PATH. Install JRE 17+ to use ViaProxy.');
  }
}

async function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = connect({ port, host });
      s.once('connect', () => {
        s.end();
        resolve(true);
      });
      s.once('error', (e) => {
        lastErr = e;
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`viaproxy: port ${port} did not open in ${timeoutMs}ms (last: ${(lastErr as any)?.message})`);
}

export interface ViaProxyHandle {
  stop: () => void;
}

export async function startViaProxy(opts: {
  bindPort: number;
  targetHost: string;
  targetPort: number;
  targetVersion: string;
}): Promise<ViaProxyHandle> {
  await checkJava();
  await ensureJar();

  const args = [
    '-jar',
    JAR_PATH,
    'cli',
    '--bind-address',
    `0.0.0.0:${opts.bindPort}`,
    '--target-address',
    `${opts.targetHost}:${opts.targetPort}`,
    '--target-version',
    opts.targetVersion,
    '--auth-method',
    'NONE',
  ];
  log('viaproxy: spawning java', args.slice(2).join(' '));

  const proc = Bun.spawn(['java', ...args], {
    cwd: VIA_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  let exited = false;
  proc.exited.then(() => {
    exited = true;
    log('viaproxy: process exited code', proc.exitCode);
  });

  try {
    await waitForPort(opts.bindPort);
  } catch (e) {
    if (exited) throw new Error('viaproxy exited before listening; check Java logs above');
    throw e;
  }
  log('viaproxy: ready on', opts.bindPort, '→', `${opts.targetHost}:${opts.targetPort}`, `(${opts.targetVersion})`);

  return {
    stop: () => {
      try {
        proc.kill();
      } catch {}
    },
  };
}
