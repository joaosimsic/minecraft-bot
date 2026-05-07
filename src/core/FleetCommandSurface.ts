import type { BotKernel } from './BotKernel';
import type { FleetRowSnapshot } from './BotFleet';
import type { FleetParseView } from './inputParse';

export type FleetCommandSurface = FleetParseView & {
  activeNonIdleOnlineCount(): number;
  haltAll(): void;
  setFocus(botId: string): boolean;
  forget(botId: string): boolean;
  onlineBotIds(): string[];
  isOnline(botId: string): boolean;
  fleetSnapshots(): FleetRowSnapshot[];
  kernel(botId: string): BotKernel | null;
};
