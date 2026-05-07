import * as readline from 'node:readline';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { Logger } from '../shared/Logger';
import type { ModeController } from './ModeController';
import type { AutoMode } from '../modes/AutoMode';
import type { GuidedMode } from '../modes/GuidedMode';

export class InputHandler {
  private readonly log = new Logger('InputHandler');
  private readonly rl: readline.Interface;

  public constructor(
    private readonly bot: Bot,
    private readonly controller: ModeController,
    private readonly autoMode: AutoMode,
    private readonly guidedMode: GuidedMode,
  ) {
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on('line', (line: string): void => {
      this.handleLine(line.trim());
    });
  }

  private handleLine(line: string): void {
    const parts = line.split(/\s+/);
    const head = parts[0] ?? '';
    this.log.event('command', { line });

    const commands: Record<string, () => void> = {
      auto:   () => this.controller.switchTo(this.autoMode),
      guided: () => this.controller.switchTo(this.guidedMode),
      stop:   () => this.controller.stop(),
      ping:   () => {
        const { x, y, z } = this.bot.entity.position;
        this.log.info('pos ->', `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
      },
      exit:   () => {
        this.controller.halt();
        this.rl.close();
      },
    };

    const cmd = commands[head];
    if (cmd !== undefined) {
      cmd();
      return;
    }

    const coords = this.parseCoords(parts);
    if (coords !== null) {
      this.guidedMode.setTarget(coords);
      this.controller.switchTo(this.guidedMode);
      this.log.info('target ->', `(${coords.x}, ${coords.y}, ${coords.z})`);
      return;
    }

    this.log.warn('unknown command. try: auto | guided | stop | ping | exit | <x> <y> <z>');
  }

  private parseCoords(parts: string[]): Vec3 | null {
    if (parts.length < 3) return null;
    const a = parts[0];
    const b = parts[1];
    const c = parts[2];
    if (a === undefined || b === undefined || c === undefined) return null;
    const x = Number(a);
    const y = Number(b);
    const z = Number(c);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
    return new Vec3(x, y, z);
  }

  public close(): void {
    this.rl.close();
  }
}
