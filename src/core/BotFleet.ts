import type { BotKernel } from './BotKernel';

export type BotPhase = 'connecting' | 'spawned' | 'running' | 'disconnected';

export type FleetRowSnapshot = {
  botId: string;
  phase: BotPhase;
  modeLabel: string;
  online: boolean;
  lastError: string | null;
  positionLabel: string | null;
  mapX: number | null;
  mapZ: number | null;
};

export type FocusedStatusSnapshot = {
  botId: string;
  phase: BotPhase;
  modeLabel: string;
  positionLabel: string | null;
  lastError: string | null;
  online: boolean;
  health: number | null;
  food: number | null;
  telemetryLine: string;
  taskLine: string | null;
};

export class BotFleet {
  private readonly kernels = new Map<string, BotKernel>();
  private readonly onlineIds = new Set<string>();
  private readonly phaseById = new Map<string, BotPhase>();
  private readonly lastErrorById = new Map<string, string | null>();
  private focusedBotId = '';
  private statusRefreshCb: () => void = (): void => undefined;
  private statusRefreshScheduled = false;

  public setStatusRefresh(fn: () => void): void {
    this.statusRefreshCb = fn;
  }

  public touchStatus(): void {
    this.statusRefresh();
  }

  private statusRefresh(): void {
    if (this.statusRefreshScheduled) return;
    this.statusRefreshScheduled = true;
    queueMicrotask((): void => {
      this.statusRefreshScheduled = false;
      this.statusRefreshCb();
    });
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
    this.phaseById.set(botId, 'disconnected');
    this.statusRefresh();
  }

  public forget(botId: string): boolean {
    if (!this.kernels.has(botId)) return false;
    if (this.onlineIds.has(botId)) return false;
    this.kernels.delete(botId);
    this.phaseById.delete(botId);
    this.lastErrorById.delete(botId);
    if (this.focusedBotId === botId) {
      const next = [...this.kernels.keys()].sort()[0];
      this.focusedBotId = next === undefined ? '' : next;
    }
    this.statusRefresh();
    return true;
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
    this.focusedBotId = botId;
    this.statusRefresh();
    return true;
  }

  public onlineKernels(): BotKernel[] {
    const out: BotKernel[] = [];
    for (const id of this.onlineIds) {
      const k = this.kernels.get(id);
      if (k !== undefined) out.push(k);
    }
    return out;
  }

  public activeNonIdleOnlineCount(): number {
    let n = 0;
    for (const id of this.onlineIds) {
      const k = this.kernels.get(id);
      if (k === undefined) continue;
      if (!k.controller.isIdle()) n += 1;
    }
    return n;
  }

  public focusedId(): string {
    return this.focusedBotId;
  }

  public kernel(botId: string): BotKernel | null {
    const k = this.kernels.get(botId);
    return k === undefined ? null : k;
  }

  public homeXZ(): { x: number; z: number } | null {
    for (const id of this.kernelIds()) {
      const k = this.kernels.get(id);
      if (k === undefined) continue;
      const h = k.runtime.home;
      if (h === null) continue;
      return { x: h.x, z: h.z };
    }
    return null;
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

  public onlineBotIds(): string[] {
    return [...this.onlineIds].sort();
  }

  public isOnline(botId: string): boolean {
    return this.onlineIds.has(botId);
  }

  public focusedSnapshot(): FocusedStatusSnapshot | null {
    const k = this.focusedKernel();
    if (k === null) return null;
    const id = k.botId;
    const e = k.bot.entity;
    const vitalsKnown = e !== undefined;
    return {
      botId: id,
      phase: this.phaseById.get(id) ?? 'connecting',
      modeLabel: k.controller.modeLabel(),
      positionLabel: this.formatPosition(k.bot),
      lastError: this.lastErrorById.get(id) ?? null,
      online: this.onlineIds.has(id),
      health: vitalsKnown ? k.bot.health : null,
      food: vitalsKnown ? k.bot.food : null,
      telemetryLine: this.formatTelemetryLine(k),
      taskLine: this.formatTaskLine(k),
    };
  }

  public fleetSnapshots(): FleetRowSnapshot[] {
    const ids = this.allRegisteredIds();
    const out: FleetRowSnapshot[] = [];
    for (const id of ids) {
      const k = this.kernels.get(id);
      const online = this.onlineIds.has(id);
      const xz = k === undefined ? null : this.mapXZ(k.bot);
      out.push({
        botId: id,
        phase: this.phaseById.get(id) ?? 'disconnected',
        modeLabel: k === undefined ? '—' : k.controller.modeLabel(),
        online,
        lastError: this.lastErrorById.get(id) ?? null,
        positionLabel: k === undefined ? null : this.formatPosition(k.bot),
        mapX: xz === null ? null : xz.x,
        mapZ: xz === null ? null : xz.z,
      });
    }
    return out;
  }

  private formatPosition(bot: BotKernel['bot']): string | null {
    const e = bot.entity;
    if (e === undefined) return null;
    const { x, y, z } = e.position;
    return `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
  }

  private mapXZ(bot: BotKernel['bot']): { x: number; z: number } | null {
    const e = bot.entity;
    if (e === undefined) return null;
    const { x, z } = e.position;
    return { x, z };
  }

  private formatTaskLine(k: BotKernel): string | null {
    const mode = k.controller.modeLabel();
    if (mode === 'GuidedMode') {
      const nav = k.guidedMode.navigationTargetLabel();
      if (nav === null) return null;
      return `nav ${nav}`;
    }
    if (mode === 'AutoMode') {
      const r = k.runtime;
      return `mine y≤${r.targetY} strip ${r.miningDir.x},${r.miningDir.y},${r.miningDir.z}`;
    }
    return null;
  }

  private formatTelemetryLine(k: BotKernel): string {
    k.metrics.ingestSampleForWindow();
    const c = k.metrics.summary().counters;
    const w = k.metrics.windowCounterDelta(
      ['blocks.dug', 'distance_walked', 'deaths', 'mode.switch'],
      60_000,
    );
    const dug = Math.round(c['blocks.dug'] ?? 0);
    const dist = Math.round(c['distance_walked'] ?? 0);
    const deaths = Math.round(c['deaths'] ?? 0);
    const modeSw = Math.round(c['mode.switch'] ?? 0);
    const wd = Math.round(w['blocks.dug'] ?? 0);
    const wdist = Math.round(w['distance_walked'] ?? 0);
    const wdeaths = Math.round(w['deaths'] ?? 0);
    const wmode = Math.round(w['mode.switch'] ?? 0);
    return `dug:${dug}(+${wd}/1m) dist:${dist}(+${wdist}/1m) deaths:${deaths}(+${wdeaths}/1m) modeΔ:${modeSw}(+${wmode}/1m)`;
  }
}
