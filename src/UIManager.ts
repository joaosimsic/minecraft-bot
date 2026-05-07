import blessed from 'blessed';
import type { FleetRowSnapshot, FocusedStatusSnapshot } from './core/BotFleet';
import type { InputUiBridge } from './core/InputHandler';
import type { LogLevel, UiLogLine } from './shared/Logger';
import { CommandPalette } from './ui/CommandPalette';
import { FleetPane } from './ui/FleetPane';
import { InputPane } from './ui/InputPane';
import { LogPane } from './ui/LogPane';
import { ScreenFrame } from './ui/ScreenFrame';
import type { UiEventBus } from './ui/UiEventBus';

const HELP_TEXT = [
  'Commands',
  '  auto | guided | stop | ping | exit',
  '  <x> <y> <z>  — guided target',
  '  focus <id> | use <id>',
  '  @<id> <cmd>  — run on named bot',
  '  @all <cmd>   — all online bots',
  '  :filter @id | :filter off',
  '  :level debug|info|warn|error|off',
  '  :save <name> "a; b"  |  :run <name>  |  :macros  |  :unsave <name>',
  '  forget <id>  — drop disconnected bot',
  '  bots | help | ?',
  '  ^K — palette (fuzzy commands / @bots)',
  '',
  'Log: click a tab above the log (all vs each bot) or use :filter',
  'Keys: F1 help · F2 multi-log columns · ^K palette · ^C quit · Tab · Up/Down history',
  'CLI: --web or WEB_COMPANION=1 — browser dashboard at http://WEB_BIND:WEB_PORT',
].join('\n');

export class UIManager implements InputUiBridge {
  private readonly frame: ScreenFrame;
  private readonly logPane: LogPane;
  private readonly fleetPane: FleetPane;
  private readonly inputPane: InputPane;
  private readonly unsubLog: () => void;
  private readonly unsubStatus: () => void;
  private readonly onQuit: () => void;
  private readonly getTabIds: () => string[];
  private readonly getMacroNames: () => string[];
  private readonly helpBox: blessed.Widgets.BoxElement;
  private readonly botsOverlay: blessed.Widgets.BoxElement;
  private readonly minSizeBox: blessed.Widgets.BoxElement;
  private readonly commandPalette: CommandPalette;
  private onFleetFocusCb: (id: string) => void = (): void => undefined;

  public constructor(
    onQuit: () => void,
    getTabIds: () => string[],
    getMacroNames: () => string[],
    bus: UiEventBus,
  ) {
    this.onQuit = onQuit;
    this.getTabIds = getTabIds;
    this.getMacroNames = getMacroNames;
    this.frame = new ScreenFrame('minecraft-bot');

    this.logPane = new LogPane(this.frame, (): void => this.onQuit());
    this.fleetPane = new FleetPane(
      this.frame,
      (id): void => this.onFleetFocusCb(id),
      (): void => this.onQuit(),
    );
    this.inputPane = new InputPane(this.frame);

    this.logPane.bindFocusInput((): void => this.inputPane.focusInput());
    this.inputPane.bindEscapeFromInput((): void =>
      this.logPane.handleEscapeFromInput(),
    );

    this.unsubLog = bus.onLog((line): void => {
      this.appendLogLine(line);
    });
    this.unsubStatus = bus.onStatus((p): void => {
      this.updateStatus(p.focused, p.fleet, p.focusedId, p.homeXZ);
    });

    this.helpBox = blessed.box({
      parent: this.frame.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      border: 'line',
      label: ' help (F1 / q to close) ',
      tags: true,
      hidden: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      content: HELP_TEXT,
    });

    this.botsOverlay = blessed.box({
      parent: this.frame.screen,
      top: 'center',
      left: 'center',
      width: '72%',
      height: '62%',
      border: 'line',
      label: ' fleet detail (q / Esc to close) ',
      tags: false,
      hidden: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      content: '',
    });

    this.minSizeBox = blessed.box({
      parent: this.frame.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      tags: true,
      hidden: true,
      valign: 'middle',
      align: 'center',
      content:
        '{yellow-fg}Terminal too small{/yellow-fg}\n\nNeed {bold}80{/bold} cols × {bold}20{/bold} rows minimum.\nEnlarge the window.',
      style: { fg: 'white', bg: 'red' },
    });

    this.commandPalette = new CommandPalette(
      this.frame,
      (): string[] => this.getTabIds(),
      (): string[] => this.getMacroNames(),
      (item): void => {
        this.inputPane.textbox.setValue(item);
        this.inputPane.focusInput();
        this.scheduleRender();
      },
      (): void => {
        this.inputPane.focusInput();
        this.scheduleRender();
      },
      (): void => this.onQuit(),
    );

    this.frame.screen.key(['C-c'], (): void => {
      this.onQuit();
    });

    this.inputPane.textbox.key(['C-c'], (): void => {
      this.onQuit();
    });

    this.frame.screen.key(['f1'], (): void => {
      this.toggleHelp();
    });

    this.frame.screen.key(['f2'], (): void => {
      this.logPane.toggleMultiLogMode();
    });

    const togglePalette = (): void => {
      if (this.commandPalette.isOpen()) {
        this.commandPalette.cancel();
        return;
      }

      if (!this.helpBox.hidden) this.hideHelp();
      if (!this.botsOverlay.hidden) this.hideBotsOverlay();

      this.commandPalette.show();
    };

    this.frame.screen.key(['C-k'], togglePalette);
    this.inputPane.textbox.key(['C-k'], togglePalette);

    this.frame.screen.on('resize', (): void => {
      this.checkMinTerminal();
      this.scheduleRender();
    });

    this.helpBox.key(['escape', 'q', 'Q', 'f1'], (): void => {
      this.hideHelp();
    });

    this.helpBox.key(['C-c'], (): void => {
      this.onQuit();
    });

    this.botsOverlay.key(['escape', 'q', 'Q'], (): void => {
      this.hideBotsOverlay();
    });

    this.botsOverlay.key(['C-c'], (): void => {
      this.onQuit();
    });

    this.inputPane.textbox.key(['tab'], (): void => {
      this.inputPane.applyTabCompletion([
        ...this.getTabIds(),
        ...this.getMacroNames(),
      ]);
    });

    for (let n = 1; n <= 9; n += 1) {
      const idx = n - 1;
      this.frame.screen.key([`M-${n}`], (): void => {
        if (this.frame.screen.focused === this.inputPane.textbox) return;
        const id = this.fleetPane.lastFleetOrderSnapshot[idx];
        if (id !== undefined) this.onFleetFocusCb(id);
      });
    }

    this.checkMinTerminal();

    this.inputPane.focusInput();
  }

  public onFleetFocus(handler: (id: string) => void): void {
    this.onFleetFocusCb = handler;
  }

  public setLogFilter(botId: string | null): void {
    this.logPane.setLogFilter(botId);
  }

  public setLogLevelMin(level: LogLevel | null): void {
    this.logPane.setLogLevelMin(level);
  }

  public applyTabCompletion(ids: string[]): void {
    this.inputPane.applyTabCompletion(ids);
  }

  public showBotsOverlay(body: string): void {
    if (!this.helpBox.hidden) this.helpBox.hide();
    this.botsOverlay.setContent(body);
    this.botsOverlay.show();
    this.botsOverlay.setFront();
    this.botsOverlay.focus();
    this.scheduleRender();
  }

  private hideBotsOverlay(): void {
    this.botsOverlay.hide();
    this.inputPane.focusInput();
    this.scheduleRender();
  }

  public toggleHelp(): void {
    if (this.helpBox.hidden) {
      if (!this.botsOverlay.hidden) this.botsOverlay.hide();
      this.helpBox.show();
      this.helpBox.setFront();
      this.helpBox.focus();
      this.scheduleRender();
      return;
    }
    this.hideHelp();
  }

  public showHelp(): void {
    if (!this.botsOverlay.hidden) this.botsOverlay.hide();
    if (this.helpBox.hidden) this.helpBox.show();
    this.helpBox.setFront();
    this.helpBox.focus();
    this.scheduleRender();
  }

  private hideHelp(): void {
    this.helpBox.hide();
    this.inputPane.focusInput();
    this.scheduleRender();
  }

  private checkMinTerminal(): void {
    const w = Number(this.frame.screen.width);
    const h = Number(this.frame.screen.height);
    if (w < 80 || h < 20) {
      this.minSizeBox.show();
      this.minSizeBox.setFront();
      return;
    }
    this.minSizeBox.hide();
  }

  public pushHistoryEntry(line: string): void {
    this.inputPane.pushHistoryEntry(line);
  }

  public appendLogLine(line: UiLogLine): void {
    this.logPane.appendLogLine(line);
  }

  public updateStatus(
    focused: FocusedStatusSnapshot | null,
    fleet: FleetRowSnapshot[],
    focusedId: string,
    homeXZ: { x: number; z: number } | null,
  ): void {
    this.fleetPane.updateStatus(
      focused,
      fleet,
      focusedId,
      homeXZ,
      (fid): void => this.inputPane.setFocusLabel(fid),
    );

    const onlineIds = fleet
      .filter((r): boolean => r.online)
      .map((r): string => r.botId);
    this.logPane.onFleetRowsUpdated(fleet, onlineIds);
  }

  private scheduleRender(): void {
    this.frame.scheduleRender();
  }

  public onSubmit(handler: (line: string) => void): void {
    this.inputPane.onSubmit(handler);
  }

  public focusInput(): void {
    this.inputPane.focusInput();
  }

  public render(): void {
    this.scheduleRender();
  }

  public destroy(): void {
    this.unsubLog();
    this.unsubStatus();
    this.frame.destroy();
  }
}
