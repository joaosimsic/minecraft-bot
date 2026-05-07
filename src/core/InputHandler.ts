import { Logger, type LogLevel } from '../shared/Logger';
import type { FleetCommandSurface } from './FleetCommandSurface';
import type { BotKernel } from './BotKernel';
import { parseCoords, parseTargetKernels } from './inputParse';
import {
  parseRunMacroLine,
  parseSaveMacroLine,
  splitMacroSteps,
} from './macroParse';
import type { MacroStore } from './MacroStore';

export type InputUiBridge = {
  confirmExitIfActive(activeNonIdle: number, onYes: () => void): void;
  showHelp(): void;
  setLogFilter(botId: string | null): void;
  setLogLevelMin(level: LogLevel | null): void;
  showBotsOverlay(body: string): void;
};

export class InputHandler {
  private readonly log: Logger;
  private static readonly macroDepthMax = 8;

  public constructor(
    private readonly fleet: FleetCommandSurface,
    private readonly uiLog: (line: string) => void,
    private readonly onExit: () => void,
    private readonly ui: InputUiBridge,
    private readonly macros: MacroStore,
  ) {
    this.log = new Logger('InputHandler');
  }

  public handleLine(rawLine: string): void {
    this.dispatchLine(rawLine.trim(), 0);
  }

  private dispatchLine(rawLine: string, depth: number): void {
    const line = rawLine.trim();
    if (line.length === 0) return;

    if (depth > InputHandler.macroDepthMax) {
      this.uiLog('macro nesting too deep');
      return;
    }

    if (depth === 0) this.log.event('command', { line });

    if (line.startsWith(':save ')) {
      if (depth > 0) {
        this.uiLog('cannot :save inside a macro');
        return;
      }
      const [se, parsed] = parseSaveMacroLine(line);
      if (se !== null) {
        this.uiLog(se);
        return;
      }
      if (parsed === null) return;
      this.macros.put(parsed.name, parsed.body);
      this.uiLog(`macro saved: ${parsed.name}`);
      return;
    }

    if (line.startsWith(':run ')) {
      const [re, name] = parseRunMacroLine(line);
      if (re !== null) {
        this.uiLog(re);
        return;
      }
      if (name === null) return;
      const body = this.macros.get(name);
      if (body === null) {
        this.uiLog(`unknown macro: ${name} (see :macros)`);
        return;
      }
      for (const step of splitMacroSteps(body)) {
        this.dispatchLine(step, depth + 1);
      }
      return;
    }

    if (line === ':macros') {
      const ns = this.macros.names();
      if (ns.length === 0) {
        this.uiLog('no macros');
        return;
      }
      this.uiLog(ns.join(', '));
      return;
    }

    if (line.startsWith(':unsave ')) {
      if (depth > 0) {
        this.uiLog('cannot :unsave inside a macro');
        return;
      }
      const id = line.slice(8).trim();
      if (!/^[\w-]+$/.test(id)) {
        this.uiLog('usage: :unsave <name>');
        return;
      }
      const ok = this.macros.remove(id);
      if (!ok) {
        this.uiLog(`no macro: ${id}`);
        return;
      }
      this.uiLog(`macro removed: ${id}`);
      return;
    }

    if (line === 'help' || line === '?') {
      this.ui.showHelp();
      return;
    }

    if (line.startsWith(':level ')) {
      const arg = line.slice(7).trim();
      if (arg === 'off') {
        this.ui.setLogLevelMin(null);
        this.uiLog('log level filter off');
        return;
      }
      const lvl = this.minLogLevelFromArg(arg);
      if (lvl === null) {
        this.uiLog('usage: :level debug|info|warn|error|off');
        return;
      }
      this.ui.setLogLevelMin(lvl);
      this.uiLog(`log level min: ${lvl}`);
      return;
    }

    if (line.startsWith(':filter ')) {
      const arg = line.slice(8).trim();
      if (arg === 'off') {
        this.ui.setLogFilter(null);
        this.uiLog('log filter off');
        return;
      }
      if (arg.startsWith('@')) {
        this.ui.setLogFilter(arg.slice(1));
        this.uiLog(`log filter: ${arg.slice(1)}`);
        return;
      }
      this.uiLog('usage: :filter @<id> | :filter off');
      return;
    }

    if (line === 'bots') {
      this.ui.showBotsOverlay(this.buildBotsOverlayText());
      return;
    }

    if (line === 'exit') {
      const n = this.fleet.activeNonIdleOnlineCount();
      this.ui.confirmExitIfActive(n, (): void => {
        this.fleet.haltAll();
        this.onExit();
      });
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
      if (!ok) this.uiLog(`cannot focus ${id} — unknown id`);
      return;
    }

    if (fh === 'forget' && !line.startsWith('@')) {
      const id = focusParts[1];
      if (id === undefined) {
        this.uiLog('usage: forget <id> (offline bots only)');
        return;
      }
      const ok = this.fleet.forget(id);
      if (!ok) this.uiLog(`cannot forget ${id} (must be disconnected)`);
      return;
    }

    const { kernels, rest } = parseTargetKernels(this.fleet, line);
    if (kernels.length === 0) {
      if (line.startsWith('@all')) {
        this.uiLog('no online bots for @all');
        return;
      }
      const online = this.fleet.onlineBotIds().join(', ');
      this.uiLog(
        `no focused bot — use focus <id> or @<id> <cmd>. Online: ${online.length === 0 ? '(none)' : online}`,
      );
      return;
    }

    const trimmed = rest.trim();
    if (trimmed.length === 0) return;

    if (trimmed === 'exit') {
      const n = this.fleet.activeNonIdleOnlineCount();
      this.ui.confirmExitIfActive(n, (): void => {
        this.fleet.haltAll();
        this.onExit();
      });
      return;
    }

    if (kernels.length === 1) {
      this.dispatchKernel(kernels[0]!, trimmed);
      return;
    }

    for (const k of kernels) {
      if (!this.fleet.isOnline(k.botId)) continue;
      this.dispatchKernel(k, trimmed);
    }
  }

  private dispatchKernel(kernel: BotKernel, trimmed: string): void {
    const bot = kernel.bot;
    const controller = kernel.controller;
    const autoMode = kernel.autoMode;
    const guidedMode = kernel.guidedMode;

    const parts = trimmed.split(/\s+/);
    const head = parts[0] ?? '';

    if (head === 'auto') {
      controller.switchTo(autoMode);
      return;
    }

    if (head === 'guided') {
      controller.switchTo(guidedMode);
      return;
    }

    if (head === 'stop') {
      controller.stop();
      return;
    }

    if (head === 'ping') {
      const e = bot.entity;
      if (e === undefined) {
        this.uiLog(`[${kernel.botId}] (no entity)`);
        return;
      }
      const { x, y, z } = e.position;
      this.uiLog(
        `[${kernel.botId}] pos (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
      );
      return;
    }

    const coords = parseCoords(parts);
    if (coords !== null) {
      guidedMode.setTarget(coords);
      controller.switchTo(guidedMode);
      this.uiLog(
        `[${kernel.botId}] target (${coords.x}, ${coords.y}, ${coords.z})`,
      );
      return;
    }

    this.uiLog(
      'unknown command. try: help | focus <id> | @<id> … | @all … | auto | guided | stop | ping | exit | <x> <y> <z> | :filter | :level | :save | :run | :macros',
    );
  }

  private buildBotsOverlayText(): string {
    const lines: string[] = [];
    for (const row of this.fleet.fleetSnapshots()) {
      lines.push(
        `${row.botId}  ${row.online ? 'on' : 'off'}  ${row.phase}  ${row.modeLabel}`,
      );
      lines.push(`  pos: ${row.positionLabel ?? '—'}`);
      lines.push(`  err: ${row.lastError ?? '—'}`);
      const k = this.fleet.kernel(row.botId);
      if (k !== null && row.modeLabel === 'GuidedMode') {
        const nav = k.guidedMode.navigationTargetLabel();
        if (nav !== null) lines.push(`  nav: ${nav}`);
      }
      if (k !== null && row.modeLabel === 'AutoMode') {
        const r = k.runtime;
        lines.push(
          `  strip: y≤${r.targetY} dir ${r.miningDir.x},${r.miningDir.y},${r.miningDir.z}`,
        );
      }
      lines.push('');
    }
    return lines.join('\n').replace(/\n+$/, '');
  }

  private minLogLevelFromArg(arg: string): LogLevel | null {
    if (arg === 'debug') return 'debug';
    if (arg === 'info') return 'info';
    if (arg === 'warn') return 'warn';
    if (arg === 'error') return 'error';
    return null;
  }
}
