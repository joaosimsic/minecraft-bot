export function log(...args: unknown[]) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...args);
}