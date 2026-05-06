export interface BotMode {
  tick(): Promise<void>;
}
