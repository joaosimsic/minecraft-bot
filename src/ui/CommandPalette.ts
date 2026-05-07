import blessed from 'blessed';
import {
  buildOrderedPaletteCandidates,
  rankPaletteCandidates,
} from './paletteRank';
import type { ScreenFrame } from './ScreenFrame';

export class CommandPalette {
  private readonly frame: ScreenFrame;
  private readonly getIds: () => string[];
  private readonly getMacroNames: () => string[];
  private readonly onPickItem: (item: string) => void;
  private readonly onCancelPalette: () => void;
  private readonly onQuit: () => void;
  private readonly box: blessed.Widgets.BoxElement;
  private readonly search: blessed.Widgets.TextboxElement;
  private readonly list: blessed.Widgets.ListElement;
  private ordered: string[] = [];
  private filtered: string[] = [];
  private open = false;

  public constructor(
    frame: ScreenFrame,
    getIds: () => string[],
    getMacroNames: () => string[],
    onPickItem: (item: string) => void,
    onCancelPalette: () => void,
    onQuit: () => void,
  ) {
    this.frame = frame;
    this.getIds = getIds;
    this.getMacroNames = getMacroNames;
    this.onPickItem = onPickItem;
    this.onCancelPalette = onCancelPalette;
    this.onQuit = onQuit;

    this.box = blessed.box({
      parent: frame.screen,
      top: 'center',
      left: 'center',
      width: '58%',
      height: '52%',
      border: 'line',
      label: ' command palette (^K toggle · Esc close · Enter) ',
      tags: true,
      hidden: true,
      keys: true,
    });

    this.search = blessed.textbox({
      parent: this.box,
      top: 1,
      left: 1,
      right: 1,
      height: 3,
      border: 'line',
      label: ' filter ',
      inputOnFocus: true,
      keys: true,
    });

    this.list = blessed.list({
      parent: this.box,
      top: 5,
      left: 1,
      right: 1,
      bottom: 1,
      border: 'line',
      label: ' matches ',
      keys: true,
      mouse: true,
      scrollable: true,
      style: { selected: { bg: 'blue', fg: 'white' } },
    });

    this.box.key(['escape'], (): void => {
      this.cancel();
    });

    const quitApp = (): void => {
      this.onQuit();
    };
    this.box.key(['C-c'], quitApp);
    this.search.key(['C-c'], quitApp);
    this.list.key(['C-c'], quitApp);

    this.search.on('keypress', (): void => {
      queueMicrotask((): void => this.refreshMatches());
    });

    this.search.key(['enter'], (): void => {
      const first = this.filtered[0];
      if (first === undefined) return;

      this.pick(first);
    });

    this.search.key(['down', 'tab'], (): void => {
      this.list.focus();
    });

    this.list.key(['S-tab'], (): void => {
      this.search.focus();
    });

    this.list.on('select', (item: string, _idx: number): void => {
      this.pick(item);
    });
  }

  public isOpen(): boolean {
    return this.open;
  }

  public show(): void {
    if (this.open) return;

    this.open = true;
    this.ordered = buildOrderedPaletteCandidates(
      this.getIds(),
      this.getMacroNames(),
    );
    this.search.clearValue();
    this.refreshMatches();
    this.box.show();
    this.box.setFront();
    this.search.focus();
    this.scheduleRender();
  }

  public cancel(): void {
    if (!this.open) return;

    this.open = false;
    this.box.hide();
    this.onCancelPalette();
    this.scheduleRender();
  }

  private pick(item: string): void {
    if (!this.open) return;

    this.open = false;
    this.box.hide();
    this.onPickItem(item);
    this.scheduleRender();
  }

  private refreshMatches(): void {
    const raw = this.search.getValue();
    const q = typeof raw === 'string' ? raw : '';

    this.filtered = rankPaletteCandidates(q, this.ordered);
    this.list.setItems(this.filtered);
    this.list.select(0);
    this.scheduleRender();
  }

  private scheduleRender(): void {
    this.frame.scheduleRender();
  }
}
