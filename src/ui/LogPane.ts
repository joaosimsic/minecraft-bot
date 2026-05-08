import blessed from 'blessed';
import type { FleetRowSnapshot } from '../core/BotFleet';
import type { UiLogLine, LogLevel } from '../shared/Logger';
import { LogStore, logLineMatchesDisplayFilters } from './LogStore';
import { logInnerDisplayWidth, wrapUiLogLine } from './logLineWrap';
import type { ScreenFrame } from './ScreenFrame';

const MULTI_LOG_LINE_CAP = 20;
const MAX_LOG_LINES_PER_UI_TICK = 512;
const LOG_SCROLLBACK = 2500;

type LogTabCmd = {
  prefix: string;
  text: string;
  callback: () => void;
};

export class LogPane {
  private readonly logStore = new LogStore();
  private readonly frame: ScreenFrame;
  private readonly onQuit: () => void;
  private focusInput: () => void = (): void => undefined;
  private readonly logTabBar: blessed.Widgets.ListbarElement;
  private readonly logArea: blessed.Widgets.BoxElement;
  private readonly logBox: blessed.Widgets.Log;
  private logFollowBottom = true;
  private logFilterBotId: string | null = null;
  private logMinLevel: LogLevel | null = null;
  private lastLogTabKey = '';
  private lastLogTabIds: string[] = [];
  private lastSyncedLogTabIdx: number | null = null;
  private multiLogMode = false;
  private multiLogColumns: blessed.Widgets.BoxElement[] = [];
  private multiLayoutKey = '';
  private lastOnlineBotIds: string[] = [];
  private readonly pendingVisible: UiLogLine[] = [];
  private logFlushScheduled = false;
  private multiDirty = false;
  private logFlushSeq = 0;
  private filterChangeCb: ((botId: string | null) => void) | null = null;

  public constructor(frame: ScreenFrame, onQuit: () => void) {
    this.frame = frame;
    this.onQuit = onQuit;
    const screen = this.frame.screen;

    this.logTabBar = blessed.listbar({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      mouse: true,
      keys: true,
      vi: true,
      autoCommandKeys: false,
      commands: [],
      items: [],
      style: {
        bg: 'black',
        item: { fg: 'white' },
        selected: { bg: 'blue', fg: 'white' },
      },
    });

    this.logArea = blessed.box({
      parent: screen,
      top: 1,
      left: 0,
      width: '70%',
      bottom: 4,
    });

    this.logBox = blessed.log({
      parent: this.logArea,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      border: 'line',
      label: ' log ',
      tags: true,
      wrap: false,
      scrollable: true,
      alwaysScroll: false,
      mouse: true,
      keys: true,
      vi: true,
      scrollback: LOG_SCROLLBACK,
      scrollbar: {
        ch: ' ',
        track: { bg: 'cyan' },
        style: { inverse: true },
      },
    });

    this.logBox.removeAllListeners('set content');

    this.logBox.on('scroll', (): void => {
      this.logFollowBottom = this.logScrolledToBottom();
    });

    this.logBox.key(['escape'], (): void => {
      this.focusInput();
      this.scheduleRender();
    });

    this.logBox.key(['C-c'], (): void => {
      this.onQuit();
    });

    this.lastLogTabIds = [];
    this.rebuildLogTabCommands();
    this.syncLogTabSelection();
  }

  public bindFocusInput(fn: () => void): void {
    this.focusInput = fn;
  }

  public bindFilterChanged(fn: (botId: string | null) => void): void {
    this.filterChangeCb = fn;
  }

  public setLogFilter(botId: string | null): void {
    if (this.logFilterBotId === botId) {
      this.syncLogTabSelection();
      return;
    }
    this.logFilterBotId = botId;
    this.refillLogFromStore();
    this.syncLogTabSelection();
    if (this.filterChangeCb !== null) this.filterChangeCb(botId);
  }

  public setLogLevelMin(level: LogLevel | null): void {
    this.logMinLevel = level;
    this.refillLogFromStore();
  }

  public onViewportResize(): void {
    if (this.multiLogMode) {
      this.fillMultiColumnContents(this.lastOnlineBotIds);
      this.scheduleRender();
      return;
    }
    const lines = this.logStore.getDisplayLines(
      this.logFilterBotId,
      this.logMinLevel,
    );
    const inner = logInnerDisplayWidth(this.logBox);
    const text = lines
      .flatMap((l): string[] => wrapUiLogLine(this.formatLogLine(l), inner))
      .join('\n');
    this.logBox.setContent(text);
    if (this.logFollowBottom) this.logBox.setScrollPerc(100);
    this.scheduleRender();
  }

  public appendLogLine(line: UiLogLine): void {
    this.logStore.append(line);
    if (this.multiLogMode) {
      this.multiDirty = true;
      this.scheduleLogFlush();
      return;
    }
    if (
      !logLineMatchesDisplayFilters(line, this.logFilterBotId, this.logMinLevel)
    ) {
      return;
    }
    this.pendingVisible.push(line);
    this.scheduleLogFlush();
  }

  public toggleMultiLogMode(): void {
    this.multiLogMode = !this.multiLogMode;
    if (!this.multiLogMode) {
      this.multiLayoutKey = '';
      this.clearMultiLogColumns();
      this.logBox.show();
      this.refillLogFromStore();
      this.scheduleRender();
      return;
    }

    this.clearLogFlushSchedule();

    this.multiLayoutKey = '';
    this.rebuildMultiColumnWidgets(this.lastOnlineBotIds);
    this.multiLayoutKey = this.lastOnlineBotIds.join('\0');
    this.fillMultiColumnContents(this.lastOnlineBotIds);
    this.scheduleRender();
  }

  public handleEscapeFromInput(): void {
    if (this.multiLogMode) {
      const first = this.multiLogColumns[0];
      if (first !== undefined) first.focus();
      this.scheduleRender();
      return;
    }
    this.logBox.focus();
    this.scheduleRender();
  }

  public onFleetRowsUpdated(
    fleet: FleetRowSnapshot[],
    onlineIds: string[],
  ): void {
    this.lastOnlineBotIds = onlineIds;

    const tabKey = fleet.map((r): string => r.botId).join('\0');
    if (tabKey !== this.lastLogTabKey) {
      this.lastLogTabKey = tabKey;
      this.lastLogTabIds = fleet.map((r): string => r.botId);
      this.lastSyncedLogTabIdx = null;
      this.rebuildLogTabCommands();
      const idSet = new Set(this.lastLogTabIds);
      const mustClearFilter =
        this.logFilterBotId !== null && !idSet.has(this.logFilterBotId);
      if (mustClearFilter) this.setLogFilter(null);
      if (!mustClearFilter) this.syncLogTabSelection();
    }

    if (!this.multiLogMode) return;

    const layoutKey = onlineIds.join('\0');
    if (layoutKey !== this.multiLayoutKey) {
      this.multiLayoutKey = layoutKey;
      this.rebuildMultiColumnWidgets(onlineIds);
    }
    this.fillMultiColumnContents(onlineIds);
  }

  private logScrolledToBottom(): boolean {
    const perc = this.logBox.getScrollPerc();
    if (perc >= 95) return true;
    const inner = this.logBox.height - this.logBox.iheight;
    const total = this.logBox.getScrollHeight();
    if (total <= inner) return true;
    return false;
  }

  private formatLogLine(line: UiLogLine): string {
    const id = line.botId === null ? '—' : line.botId;
    return `[${id}] ${line.text}`;
  }

  private wireMultiPaneEscape(box: blessed.Widgets.BoxElement): void {
    box.key(['escape'], (): void => {
      this.focusInput();
      this.scheduleRender();
    });
    box.key(['C-c'], (): void => {
      this.onQuit();
    });
  }

  private columnGeom(i: number, n: number): [string, string] {
    const w = Math.floor(100 / n);
    const leftPct = i * w;
    if (i === n - 1) return [`${leftPct}%`, `${100 - leftPct}%`];
    return [`${leftPct}%`, `${w}%`];
  }

  private clearMultiLogColumns(): void {
    for (const b of this.multiLogColumns) b.destroy();
    this.multiLogColumns = [];
  }

  private rebuildMultiColumnWidgets(ids: string[]): void {
    this.clearMultiLogColumns();
    this.logBox.hide();
    if (ids.length === 0) {
      const b = blessed.box({
        parent: this.logArea,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        border: 'line',
        label: ' multi ',
        tags: true,
        content: '{yellow-fg}no online bots{/yellow-fg}',
        valign: 'middle',
      });
      this.multiLogColumns.push(b);
      this.wireMultiPaneEscape(b);
      return;
    }
    const n = ids.length;
    for (let i = 0; i < n; i += 1) {
      const id = ids[i]!;
      const [left, width] = this.columnGeom(i, n);
      const b = blessed.box({
        parent: this.logArea,
        top: 0,
        bottom: 0,
        left,
        width,
        border: 'line',
        label: ` ${id} `,
        tags: true,
        wrap: false,
        scrollable: true,
        mouse: true,
        scrollbar: {
          ch: ' ',
          track: { bg: 'cyan' },
          style: { inverse: true },
        },
      });
      this.multiLogColumns.push(b);
      this.wireMultiPaneEscape(b);
    }
  }

  private fillMultiColumnContents(ids: string[]): void {
    if (ids.length === 0) return;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      const col = this.multiLogColumns[i];
      if (col === undefined) continue;
      const lines = this.logStore.getRecentBotLines(
        id,
        MULTI_LOG_LINE_CAP,
        this.logMinLevel,
      );
      const inner = logInnerDisplayWidth(col);
      const text = lines
        .flatMap((l): string[] => wrapUiLogLine(l.text, inner))
        .join('\n');
      col.setContent(text);
      col.setScrollPerc(100);
    }
  }

  private clearLogFlushSchedule(): void {
    this.pendingVisible.length = 0;
    this.multiDirty = false;
    this.logFlushScheduled = false;
    this.logFlushSeq += 1;
  }

  private scheduleLogFlush(): void {
    if (this.logFlushScheduled) return;
    this.logFlushScheduled = true;
    const seq = this.logFlushSeq;
    setImmediate((): void => {
      if (seq !== this.logFlushSeq) {
        this.logFlushScheduled = false;
        return;
      }
      this.flushLogPending();
    });
  }

  private flushLogPending(): void {
    this.logFlushScheduled = false;
    if (this.multiLogMode) {
      if (!this.multiDirty) return;
      this.multiDirty = false;
      this.fillMultiColumnContents(this.lastOnlineBotIds);
      this.scheduleRender();
      return;
    }
    if (this.pendingVisible.length === 0) return;

    const taken = this.pendingVisible.splice(0, MAX_LOG_LINES_PER_UI_TICK);
    const inner = logInnerDisplayWidth(this.logBox);
    for (const line of taken) {
      const wrapped = wrapUiLogLine(this.formatLogLine(line), inner);
      this.logBox.log(wrapped.join('\n'));
    }

    if (this.logFollowBottom) this.logBox.setScrollPerc(100);
    this.scheduleRender();

    if (this.pendingVisible.length > 0) this.scheduleLogFlush();
  }

  private refillLogFromStore(): void {
    this.clearLogFlushSchedule();
    if (this.multiLogMode) {
      this.fillMultiColumnContents(this.lastOnlineBotIds);
      this.scheduleRender();
      return;
    }
    const lines = this.logStore.getDisplayLines(
      this.logFilterBotId,
      this.logMinLevel,
    );
    const inner = logInnerDisplayWidth(this.logBox);
    const text = lines
      .flatMap((l): string[] => wrapUiLogLine(this.formatLogLine(l), inner))
      .join('\n');
    this.logBox.setContent(text);
    this.logBox.setScrollPerc(100);
    this.logFollowBottom = true;
    this.scheduleRender();
  }

  private rebuildLogTabCommands(): void {
    const cmds: LogTabCmd[] = [
      {
        prefix: '0',
        text: 'all',
        callback: (): void => this.setLogFilter(null),
      },
    ];
    let n = 0;
    for (const id of this.lastLogTabIds) {
      n += 1;
      cmds.push({
        prefix: String(n),
        text: id,
        callback: (): void => this.setLogFilter(id),
      });
    }
    this.logTabBar.setItems(
      cmds as unknown as blessed.Widgets.Types.ListbarCommand[],
    );
    this.scheduleRender();
  }

  private syncLogTabSelection(): void {
    let idx = 0;
    if (this.logFilterBotId !== null) {
      const i = this.lastLogTabIds.indexOf(this.logFilterBotId);
      if (i >= 0) idx = i + 1;
    }
    if (this.lastSyncedLogTabIdx === idx) return;
    this.lastSyncedLogTabIdx = idx;
    this.logTabBar.select(idx);
    this.scheduleRender();
  }

  private scheduleRender(): void {
    this.frame.scheduleRender();
  }
}
