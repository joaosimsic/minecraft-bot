import { Vec3 } from 'vec3';
import { Logger } from '../shared/Logger';
import type { ModeController } from './ModeController';
import type { AutoMode } from '../modes/AutoMode';
import type { GuidedMode } from '../modes/GuidedMode';
import type { BotFleet } from './BotFleet';
import type { BotKernel } from './BotKernel';

export class InputHandler {
  private readonly log: Logger;

  public constructor(
    private readonly fleet: BotFleet,
    private readonly uiLog: (line: string) => void,
    private readonly onExit: () => void,
  ) {
    this.log = new Logger('InputHandler');
  }

  public handleLine(rawLine: string): void {
    const line = rawLine.trim();
    if (line.length === 0) return;

    this.log.event('command', { line });

    if (line === 'bots') {
      this.logBots();
      return;
    }

    if (line === 'exit') {
      this.fleet.haltAll();
      this.onExit();
      return;
    }

    const focusParts = line.split(/\s+/);
    const fh = focusParts[0] ?? '';
    if ((fh === 'focus' || fh === 'use') && !line.startsWith('@')) {
      const id = focusParts[1];
      if (id === undefined) {
        this.uiLog('usage: focus <id>');
        return;
      }
      const ok = this.fleet.setFocus(id);
      if (!ok) this.uiLog(`cannot focus ${id}`);
      return;
    }

    const { target, rest } = this.parseTarget(line);
    if (target === null) {
      this.uiLog('no bot resolved for command');
      return;
    }

    const trimmed = rest.trim();
    if (trimmed.length === 0) return;

    if (trimmed === 'exit') {
      this.fleet.haltAll();
      this.onExit();
      return;
    }

    const kernel = target;
    const bot = kernel.bot;
    const controller = kernel.controller;
    const autoMode = kernel.autoMode;
    const guidedMode = kernel.guidedMode;

    const parts = trimmed.split(/\s+/);
    const head = parts[0] ?? '';

    const commands: Record<string, () => void> = {
      auto: () => controller.switchTo(autoMode),
      guided: () => controller.switchTo(guidedMode),
      stop: () => controller.stop(),
      ping: () => {
        const { x, y, z } = bot.entity.position;
        this.uiLog(
          `[${kernel.botId}] pos (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
        );
      },
    };

    const cmd = commands[head];
    if (cmd !== undefined) {
      cmd();
      return;
    }

    const coords = this.parseCoords(parts);
    if (coords !== null) {
      guidedMode.setTarget(coords);
      controller.switchTo(guidedMode);
      this.uiLog(
        `[${kernel.botId}] target (${coords.x}, ${coords.y}, ${coords.z})`,
      );
      return;
    }

    this.uiLog(
      'unknown command. try: bots | focus <id> | @<id> … | auto | guided | stop | ping | exit | <x> <y> <z>',
    );
  }

  private logBots(): void {
    const rows = this.fleet.fleetSnapshots();
    const text = rows
      .map((r) => `${r.botId} online=${r.online} phase=${r.phase}`)
      .join('\n');
    this.uiLog(text.length === 0 ? '(no bots)' : text);
  }

  private parseTarget(line: string): {
    target: BotKernel | null;
    rest: string;
  } {
    if (line.startsWith('@')) {
      const space = line.indexOf(' ');
      if (space === -1) {
        const id = line.slice(1);
        const k = this.fleet.resolveKernel(id);
        return { target: k, rest: '' };
      }
      const id = line.slice(1, space);
      const k = this.fleet.resolveKernel(id);
      return { target: k, rest: line.slice(space + 1) };
    }

    return { target: this.fleet.focusedKernel(), rest: line };
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
}
