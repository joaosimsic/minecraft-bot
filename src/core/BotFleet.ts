import type { BotKernel } from './BotKernel';

export type BotPhase = 'connecting' | 'spawned' | 'running' | 'disconnected';

export type FleetRowSnapshot = {
  botId: string;
  phase: BotPhase;
  modeLabel: string;
  online: boolean;
  lastError: string | null;
  positionLabel: string | null;
};

export type FocusedStatusSnapshot = {
  botId: string;
  phase: BotPhase;
  modeLabel: string;
  positionLabel: string | null;
  lastError: string | null;
};

export class BotFleet {
  private readonly kernels = new Map<string, BotKernel>();
  private readonly onlineIds = new Set<string>();
  private readonly phaseById = new Map<string, BotPhase>();
  private readonly lastErrorById = new Map<string, string>();
  private focusedBotId = '';
  private statusRefresh: () => void = (): void => undefined;
  private statusTimer: NodeJS.Timeout | null = null;

  public setStatusRefresh(fn: () => void): void {
    this.statusRefresh = fn;
  }

  public touchStatus(): void {
    this.statusRefresh();
  }

  public startStatusTicker(): void {
    if (this.statusTimer !== null) return;
    this.statusTimer = setInterval((): void => this.statusRefresh(), 2000);
  }

  public stopStatusTicker(): void {
    if (this.statusTimer === null) return;
    clearInterval(this.statusTimer);
    this.statusTimer = null;
  }

  public register(kernel: BotKernel): void {
    const id = kernel.botId;
    this.kernels.set(id, kernel);
    this.onlineIds.add(id);
    this.phaseById.set(id, 'connecting');
    this.lastErrorById.set(id, null);
    if (this.focusedBotId.length === 0) this.focusedBotId = id;
    this.statusRefresh();
  }

  public setPhase(botId: string, phase: BotPhase): void {
    this.phaseById.set(botId, phase);
    this.statusRefresh();
  }

  public recordError(botId: string, message: string): void {
    this.lastErrorById.set(botId, message);
    this.statusRefresh();
  }

  public markDisconnected(botId: string): void {
    this.onlineIds.delete(botId);
    this.kernels.delete(botId);
    this.phaseById.set(botId, 'disconnected');
    if (this.focusedBotId === botId) {
      const next = this.firstOnlineId();
      this.focusedBotId = next === null ? '' : next;
    }
    this.statusRefresh();
  }

  public kernelIds(): string[] {
    return [...this.kernels.keys()].sort();
  }

  public allRegisteredIds(): string[] {
    const s = new Set([...this.phaseById.keys(), ...this.kernels.keys()]);
    return [...s].sort();
  }

  public setFocus(botId: string): boolean {
    if (!this.kernels.has(botId)) return false;
    if (!this.onlineIds.has(botId)) return false;
    this.focusedBotId = botId;
    this.statusRefresh();
    return true;
  }

  public focusedId(): string {
    return this.focusedBotId;
  }

  public kernel(botId: string): BotKernel | null {
    const k = this.kernels.get(botId);
    return k === undefined ? null : k;
  }

  public focusedKernel(): BotKernel | null {
    if (this.focusedBotId.length === 0) return null;
    return this.kernel(this.focusedBotId);
  }

  public resolveKernel(spec: string): BotKernel | null {
    if (this.kernels.has(spec)) return this.kernel(spec);
    const lower = spec.toLowerCase();
    for (const id of this.kernels.keys()) {
      if (id.toLowerCase() === lower) return this.kernel(id);
    }
    return null;
  }

  public haltAll(): void {
    for (const k of this.kernels.values()) {
      k.controller.halt();
    }
  }

  public onlineCount(): number {
    return this.onlineIds.size;
  }

  public focusedSnapshot(): FocusedStatusSnapshot | null {
    const k = this.focusedKernel();
    if (k === null) return null;
    const id = k.botId;
    return {
      botId: id,
      phase: this.phaseById.get(id) ?? 'connecting',
      modeLabel: k.controller.modeLabel(),
      positionLabel: this.formatPosition(k.bot),
      lastError: this.lastErrorById.get(id) ?? null,
    };
  }

  public fleetSnapshots(): FleetRowSnapshot[] {
    const ids = this.allRegisteredIds();
    const out: FleetRowSnapshot[] = [];
    for (const id of ids) {
      const k = this.kernels.get(id);
      const online = this.onlineIds.has(id);
      out.push({
        botId: id,
        phase: this.phaseById.get(id) ?? 'disconnected',
        modeLabel: k === undefined ? '—' : k.controller.modeLabel(),
        online,
        lastError: this.lastErrorById.get(id) ?? null,
        positionLabel: k === undefined ? null : this.formatPosition(k.bot),
      });
    }
    return out;
  }

  private firstOnlineId(): string | null {
    const it = this.onlineIds.values().next();
    if (it.done === true) return null;
    return it.value;
  }

  private formatPosition(bot: BotKernel['bot']): string | null {
    const e = bot.entity;
    if (e === undefined) return null;
    const { x, y, z } = e.position;
    return `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
  }
}
