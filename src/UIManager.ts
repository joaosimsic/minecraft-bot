import blessed from 'blessed';
import type { FleetRowSnapshot, FocusedStatusSnapshot } from './core/BotFleet';
import type { UiLogLine } from './shared/Logger';

export class UIManager {
  private readonly screen: blessed.Widgets.Screen;
  private readonly logBox: blessed.Widgets.Log;
  private readonly statusBox: blessed.Widgets.BoxElement;
  private readonly inputBox: blessed.Widgets.TextboxElement;
  private readonly onQuit: () => void;

  public constructor(onQuit: () => void) {
    this.onQuit = onQuit;
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'minecraft-bot',
    });

    this.logBox = blessed.log({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '70%',
      height: '100%-3',
      border: 'line',
      label: ' log ',
      tags: false,
      wrap: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: {
        ch: ' ',
        track: { bg: 'cyan' },
        style: { inverse: true },
      },
    });

    this.statusBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: '70%',
      right: 0,
      height: '100%-3',
      border: 'line',
      label: ' status ',
      tags: false,
      wrap: false,
      scrollable: true,
      alwaysScroll: true,
    });

    this.inputBox = blessed.textbox({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' input ',
      inputOnFocus: true,
      keys: true,
    });

    this.screen.key(['escape', 'C-c'], (): void => {
      this.onQuit();
    });

    this.inputBox.focus();
  }

  public appendLogLine(line: UiLogLine): void {
    const id = line.botId === null ? '—' : line.botId;
    this.logBox.add(`[${id}] ${line.text}\n`);
    this.screen.render();
  }

  public updateStatus(
    focused: FocusedStatusSnapshot | null,
    fleet: FleetRowSnapshot[],
  ): void {
    const focusLines =
      focused === null
        ? ['no focus']
        : [
            focused.botId,
            `phase: ${focused.phase}`,
            `mode: ${focused.modeLabel}`,
            `pos: ${focused.positionLabel ?? '—'}`,
            `err: ${focused.lastError ?? '—'}`,
          ];

    const fleetLines = fleet.map((r): string => {
      const on = r.online ? 'on' : 'off';
      const pos = r.positionLabel === null ? '—' : r.positionLabel;
      return `${r.botId} ${on} ${r.phase} ${r.modeLabel} ${pos}`;
    });

    const text = [
      '-- focused --',
      ...focusLines,
      '',
      '-- fleet --',
      ...fleetLines,
    ].join('\n');

    this.statusBox.setContent(text);
    this.screen.render();
  }

  public onSubmit(handler: (line: string) => void): void {
    this.inputBox.on('submit', (value: string): void => {
      handler(value.trim());
      this.inputBox.clearValue();
      this.inputBox.focus();
      this.screen.render();
    });
  }

  public focusInput(): void {
    this.inputBox.focus();
    this.screen.render();
  }

  public render(): void {
    this.screen.render();
  }

  public destroy(): void {
    this.screen.destroy();
  }
}
