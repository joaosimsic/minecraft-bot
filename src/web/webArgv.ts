export type WebArgv = {
  enable: boolean;
  port: number | null;
};

export function parseWebArgv(argv: readonly string[]): WebArgv {
  let enable = false;
  let port: number | null = null;
  for (const a of argv) {
    if (a === '--web') {
      enable = true;
      continue;
    }
    if (!a.startsWith('--web-port=')) continue;
    const raw = a.slice('--web-port='.length);
    const n = Number(raw);
    if (!Number.isInteger(n)) continue;
    if (n < 1) continue;
    if (n > 65535) continue;
    port = n;
  }
  return { enable, port };
}
