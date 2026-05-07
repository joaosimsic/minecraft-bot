import type { FleetRowSnapshot, FocusedStatusSnapshot } from '../core/BotFleet';
import type { UiLogLine } from '../shared/Logger';

export type UiStatusPayload = {
  focused: FocusedStatusSnapshot | null;
  fleet: FleetRowSnapshot[];
  focusedId: string;
  homeXZ: { x: number; z: number } | null;
};

export class UiEventBus {
  private logSubs = new Set<(line: UiLogLine) => void>();
  private statusSubs = new Set<(p: UiStatusPayload) => void>();

  public onLog(handler: (line: UiLogLine) => void): () => void {
    this.logSubs.add(handler);
    return (): void => {
      this.logSubs.delete(handler);
    };
  }

  public onStatus(handler: (p: UiStatusPayload) => void): () => void {
    this.statusSubs.add(handler);
    return (): void => {
      this.statusSubs.delete(handler);
    };
  }

  public emitLog(line: UiLogLine): void {
    for (const f of this.logSubs) f(line);
  }

  public emitStatus(p: UiStatusPayload): void {
    for (const f of this.statusSubs) f(p);
  }
}
