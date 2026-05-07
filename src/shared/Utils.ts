import type { Bot } from 'mineflayer';
import type { Item } from 'prismarine-item';
import type { AsyncResult, Result } from './result';
import { wrap } from './result';

export class Utils {
  public static sleep(ms: number): Promise<void> {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  public static findItem(
    bot: Bot,
    predicate: (name: string) => boolean,
  ): Item | undefined {
    return bot.inventory.items().find((i) => predicate(i.name));
  }

  public static countItem(bot: Bot, predicate: (name: string) => boolean): number {
    return bot.inventory
      .items()
      .filter((i) => predicate(i.name))
      .reduce((sum, i) => sum + i.count, 0);
  }

  public static pickaxeTier(name: string): number {
    if (name.includes('diamond')) return 4;

    if (name.includes('iron')) return 3;

    if (name.includes('stone')) return 2;

    if (name.includes('wood') || name.includes('wooden')) return 1;

    return 0;
  }

  public static async withTimeout<T>(
    p: Promise<T>,
    ms: number,
    label: string,
  ): AsyncResult<T> {
    const settled = wrap(p);

    const timed = Utils.sleep(ms).then(
      (): Result<T> => [new Error(`timeout: ${label}`), null],
    );
    return Promise.race([settled, timed]);
  }
}
