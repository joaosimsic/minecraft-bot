import blessed from 'blessed';
import { REPL_COMMAND_HEADS } from './replCommands';
import type { ScreenFrame } from './ScreenFrame';

export class InputPane {
  private readonly frame: ScreenFrame;
  public readonly textbox: blessed.Widgets.TextboxElement;
  private onEscapeFromInput: () => void = (): void => undefined;
  private readonly cmdHistory: string[] = [];
  private histBrowse: number | null = null;
  private tabCycle = 0;
  private tabPrefix = '';

  public constructor(frame: ScreenFrame) {
    this.frame = frame;

    this.textbox = blessed.textbox({
      parent: frame.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' input ',
      inputOnFocus: true,
      keys: true,
    });

    this.textbox.on(
      'keypress',
      (ch: string | undefined, key: { name?: string }): void => {
        this.handleInputKeypress(ch, key);
      },
    );
  }

  public bindEscapeFromInput(fn: () => void): void {
    this.onEscapeFromInput = fn;
  }

  public setFocusLabel(fid: string): void {
    this.textbox.setLabel(` [focus: ${fid}] `);
  }

  public applyTabCompletion(ids: string[]): void {
    const raw = this.textbox.getValue();
    const line = typeof raw === 'string' ? raw : '';
    const leadMatch = line.match(/^\s*/);
    const lead = leadMatch?.[0] ?? '';
    const trimmed = line.slice(lead.length);
    const firstSpace = trimmed.search(/\s/);
    const head = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    const tail = firstSpace === -1 ? '' : trimmed.slice(firstSpace);
    let cands: string[] = [];
    if (head.startsWith('@')) {
      const pool = ['@all', ...ids.map((id): string => `@${id}`)];
      cands = pool.filter((x): boolean =>
        x.toLowerCase().startsWith(head.toLowerCase()),
      );
    }
    if (!head.startsWith('@')) {
      const pool = [...new Set([...REPL_COMMAND_HEADS, ...ids])];
      cands = pool.filter((x): boolean =>
        x.toLowerCase().startsWith(head.toLowerCase()),
      );
    }
    if (cands.length === 0) return;
    if (this.tabPrefix !== head) {
      this.tabPrefix = head;
      this.tabCycle = 0;
    }
    const pick = cands[this.tabCycle % cands.length]!;
    this.tabCycle += 1;
    this.textbox.setValue(`${lead}${pick}${tail}`);
    this.histBrowse = null;
    this.scheduleRender();
  }

  public pushHistoryEntry(line: string): void {
    if (line.length === 0) return;
    const last = this.cmdHistory[this.cmdHistory.length - 1];
    if (last !== line) {
      this.cmdHistory.push(line);
      if (this.cmdHistory.length > 100)
        this.cmdHistory.splice(0, this.cmdHistory.length - 100);
    }
  }

  public focusInput(): void {
    this.textbox.focus();
    this.scheduleRender();
  }

  public onSubmit(handler: (line: string) => void): void {
    this.textbox.on('submit', (value: string): void => {
      const line = value.trim();
      this.pushHistoryEntry(line);
      this.histBrowse = null;
      handler(line);
      this.textbox.clearValue();
      this.textbox.focus();
      this.scheduleRender();
    });
  }

  private handleInputKeypress(
    ch: string | undefined,
    key: { name?: string },
  ): void {
    if (key.name !== 'up' && key.name !== 'down') {
      if (
        (ch?.length ?? 0) > 0 ||
        key.name === 'enter' ||
        key.name === 'return'
      )
        this.histBrowse = null;
    }

    if (key.name === 'escape') {
      this.onEscapeFromInput();
      return;
    }

    if (key.name === 'up') {
      if (this.cmdHistory.length === 0) return;
      if (this.histBrowse === null) this.histBrowse = this.cmdHistory.length;
      this.histBrowse -= 1;
      if (this.histBrowse < 0) this.histBrowse = 0;
      const v = this.cmdHistory[this.histBrowse];
      if (v !== undefined) this.textbox.setValue(v);
      this.scheduleRender();
      return;
    }

    if (key.name === 'down') {
      if (this.histBrowse === null) return;
      this.histBrowse += 1;
      if (this.histBrowse >= this.cmdHistory.length) {
        this.histBrowse = null;
        this.textbox.clearValue();
        this.scheduleRender();
        return;
      }
      const v = this.cmdHistory[this.histBrowse];
      if (v !== undefined) this.textbox.setValue(v);
      this.scheduleRender();
    }
  }

  private scheduleRender(): void {
    this.frame.scheduleRender();
  }
}
