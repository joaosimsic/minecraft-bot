import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { NavigationController } from '../../src/navigation/NavigationController';

describe('NavigationController probe lifecycle', () => {
  test('does not subscribe physicsTick listener by default', () => {
    const bot = new EventEmitter() as unknown as Bot;

    (
      bot as unknown as {
        entity: Bot['entity'];
        time: { age: number };
      }
    ).entity = {
      position: {
        distanceTo(): number {
          return 999;
        },
      },
    } as unknown as Bot['entity'];
    (
      bot as unknown as {
        time: { age: number };
      }
    ).time = { age: 0 };

    bot.blockAt = (): null => null;
    bot.entities = {};
    bot.setControlState = (): void => {};

    new NavigationController(bot, 'test');

    const ee = bot as unknown as EventEmitter;

    expect(ee.listenerCount('physicsTick')).toBe(0);
    let pulse = 0;
    while (pulse < 200) {
      ee.emit('physicsTick');
      pulse += 1;
    }
    expect(ee.listenerCount('physicsTick')).toBe(0);
  });
});
