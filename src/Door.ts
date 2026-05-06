import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { Logger } from './Logger';

interface BlockWithProps extends Block {
  properties?: Record<string, string | boolean>;
}

export class Door {
  private readonly log = new Logger('Door');
  private readonly recentlyToggled = new Set<string>();

  constructor(private readonly bot: Bot) {}

  public isDoor(name: string): boolean {
    return /door/i.test(name);
  }

  public async openDoorAt(pos: Vec3): Promise<boolean> {
    const block = this.bot.blockAt(pos) as BlockWithProps | null;

    if (!block || !this.isDoor(block.name)) return false;

    const key = `${pos.x},${pos.y},${pos.z}`;

    if (this.recentlyToggled.has(key)) return true;

    const props = block.properties ?? {};

    if (props.half === 'upper') return false;

    if (props.open === 'true' || props.open === true) return true;

    this.recentlyToggled.add(key);

    setTimeout(() => this.recentlyToggled.delete(key), 4000);

    return this.bot
      .activateBlock(block)
      .then(() => {
        this.log.info('opened at', `(${pos.x}, ${pos.y}, ${pos.z})`);
        void this.closeDoorWhenClear(block, pos);
        return true as const;
      })
      .catch((e: Error) => {
        this.log.error('open fail', e.message);
        return false as const;
      });
  }

  public async openDoorsAhead(): Promise<void> {
    const pos = this.bot.entity.position.floored();
    const yaw = this.bot.entity.yaw;
    const front = new Vec3(
      Math.floor(pos.x + Math.round(-Math.sin(yaw))),
      pos.y,
      Math.floor(pos.z + Math.round(-Math.cos(yaw))),
    );

    await this.openDoorAt(front);

    await this.openDoorAt(front.offset(0, 1, 0));
  }

  private async closeDoorWhenClear(block: Block, pos: Vec3): Promise<void> {
    const start = Date.now();

    let hasSteppedInside = false;

    while (Date.now() - start < 8000) {
      const dist = this.bot.entity.position.distanceTo(pos.offset(0.5, 0, 0.5));

      if (!hasSteppedInside && dist < 1.0) hasSteppedInside = true;

      if (hasSteppedInside && dist > 1.5) {
        await new Promise<void>((r) => setTimeout(r, 300));

        await this.bot
          .activateBlock(block)
          .catch((e: Error) => this.log.error('close fail', e.message));
        this.log.info('closed at', `(${pos.x}, ${pos.y}, ${pos.z})`);

        return;
      }

      await new Promise<void>((r) => setTimeout(r, 200));
    }
  }
}

