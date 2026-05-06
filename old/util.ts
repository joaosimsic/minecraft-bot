import type { Bot } from 'mineflayer';
import type { Item } from 'prismarine-item';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function findItem(bot: Bot, predicate: (n: string) => boolean): Item | undefined {
  return bot.inventory.items().find((i) => predicate(i.name));
}

export function countItem(bot: Bot, predicate: (n: string) => boolean): number {
  return bot.inventory
    .items()
    .filter((i) => predicate(i.name))
    .reduce((s, i) => s + i.count, 0);
}

export function pickaxeTier(name: string): number {
  if (name.includes('diamond')) return 4;
  if (name.includes('iron')) return 3;
  if (name.includes('stone')) return 2;
  if (name.includes('wood') || name.includes('wooden')) return 1;
  return 0;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);
}
