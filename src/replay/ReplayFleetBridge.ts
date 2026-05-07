import type { FleetRowSnapshot } from '../core/BotFleet';
import { ReplayState } from './ReplayState';
import type { BotKernel } from '../core/BotKernel';
import type { FleetCommandSurface } from '../core/FleetCommandSurface';

export class ReplayFleetBridge implements FleetCommandSurface {
  public constructor(
    private readonly state: ReplayState,
    private readonly pulse: () => void,
  ) {}

  public resolveKernel(_spec: string): BotKernel | null {
    return null;
  }

  public focusedKernel(): BotKernel | null {
    return null;
  }

  public onlineKernels(): BotKernel[] {
    return [];
  }

  public activeNonIdleOnlineCount(): number {
    return 0;
  }

  public haltAll(): void {
    return;
  }

  public setFocus(botId: string): boolean {
    const ok = this.state.setFocus(botId);
    if (!ok) return false;
    this.pulse();
    return true;
  }

  public forget(botId: string): boolean {
    const ok = this.state.forgetIfOffline(botId);
    if (!ok) return false;
    this.pulse();
    return true;
  }

  public onlineBotIds(): string[] {
    return this.state.onlineBotIds();
  }

  public isOnline(botId: string): boolean {
    return new Set(this.state.onlineBotIds()).has(botId);
  }

  public fleetSnapshots(): FleetRowSnapshot[] {
    return this.state.toPayload(null).fleet;
  }

  public kernel(_botId: string): BotKernel | null {
    return null;
  }
}
