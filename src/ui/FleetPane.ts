import blessed from 'blessed';
import type { FleetRowSnapshot, FocusedStatusSnapshot } from '../core/BotFleet';
import { MiniMapFormatter, type MiniMapBot } from './MiniMap';
import type { ScreenFrame } from './ScreenFrame';

export class FleetPane {
  private readonly frame: ScreenFrame;
  private readonly onFleetRowSelect: (id: string) => void;
  private readonly statusWrap: blessed.Widgets.BoxElement;
  private readonly focusedBox: blessed.Widgets.BoxElement;
  private readonly miniMapBox: blessed.Widgets.BoxElement;
  private readonly fleetTable: blessed.Widgets.ListTableElement;
  private readonly footer: blessed.Widgets.BoxElement;
  private fleetRowIds: string[] = [];
  private lastFleetOrder: string[] = [];
  private lastMiniMapKey = '';
  private lastFocusedKey = '';
  private lastTableKey = '';
  private lastSelectedIdx = -1;
  private lastFooterText = '';
  private suppressSelectEvent = false;

  public get lastFleetOrderSnapshot(): string[] {
    return this.lastFleetOrder;
  }

  public constructor(
    frame: ScreenFrame,
    onFleetRowSelect: (id: string) => void,
    private readonly onQuit: () => void,
  ) {
    this.frame = frame;
    this.onFleetRowSelect = onFleetRowSelect;

    this.statusWrap = blessed.box({
      parent: frame.screen,
      top: 0,
      left: '70%',
      right: 0,
      bottom: 4,
      border: 'line',
      label: ' status ',
      tags: false,
    });

    const focusedRow = blessed.box({
      parent: this.statusWrap,
      top: 0,
      left: 0,
      right: 0,
      height: '50%',
    });

    this.focusedBox = blessed.box({
      parent: focusedRow,
      top: 0,
      left: 0,
      width: '62%',
      height: '100%',
      tags: false,
      wrap: false,
    });

    this.miniMapBox = blessed.box({
      parent: focusedRow,
      top: 0,
      left: '62%',
      right: 0,
      height: '100%',
      border: 'line',
      label: ' xz ',
      tags: true,
      wrap: false,
      content: '',
    });

    this.fleetTable = blessed.listtable({
      parent: this.statusWrap,
      top: '50%',
      left: 0,
      right: 0,
      bottom: 0,
      keys: true,
      mouse: true,
      vi: true,
      tags: true,
      style: {
        header: { bold: true, fg: 'cyan' },
        cell: { fg: 'white', selected: { bg: 'blue' } },
      },
      data: [
        ['id', 'on', 'phase', 'mode', 'pos', 'err'],
        ['—', '—', '—', '—', '—', '—'],
      ],
    });

    this.footer = blessed.box({
      parent: frame.screen,
      bottom: 3,
      left: 0,
      width: '100%',
      height: 1,
      tags: false,
      style: { fg: 'gray' },
    });

    this.fleetTable.on(
      'select item',
      (_el: blessed.Widgets.BoxElement, index: number): void => {
        if (this.suppressSelectEvent) return;
        const id = this.fleetRowIds[index];
        if (id === undefined) return;
        this.onFleetRowSelect(id);
      },
    );

    this.fleetTable.key(['C-c'], (): void => {
      this.onQuit();
    });
  }

  public updateStatus(
    focused: FocusedStatusSnapshot | null,
    fleet: FleetRowSnapshot[],
    focusedId: string,
    homeXZ: { x: number; z: number } | null,
    setInputFocusLabel: (fid: string) => void,
  ): void {
    const focusLines =
      focused === null
        ? ['no focus']
        : [
            focused.botId,
            `phase: ${focused.phase}`,
            `mode: ${focused.modeLabel}`,
            focused.taskLine === null ? null : `task: ${focused.taskLine}`,
            `pos: ${focused.positionLabel ?? '—'}`,
            focused.health === null
              ? 'hp/food: —'
              : `hp: ${focused.health} food: ${focused.food}`,
            `tel: ${focused.telemetryLine}`,
            `err: ${focused.lastError ?? '—'}`,
          ].filter((line): line is string => line !== null);
    const focusedText = focusLines.join('\n');
    if (focusedText !== this.lastFocusedKey) {
      this.lastFocusedKey = focusedText;
      this.focusedBox.setContent(focusedText);
    }

    const mapBots: MiniMapBot[] = [];
    for (const r of fleet) {
      if (r.mapX === null || r.mapZ === null) continue;
      mapBots.push({
        id: r.botId,
        mapX: r.mapX,
        mapZ: r.mapZ,
        online: r.online,
        focused: r.botId === focusedId,
      });
    }

    const mapStr = MiniMapFormatter.render({
      cols: 11,
      rows: 5,
      homeX: homeXZ === null ? null : homeXZ.x,
      homeZ: homeXZ === null ? null : homeXZ.z,
      bots: mapBots,
    });
    if (mapStr !== this.lastMiniMapKey) {
      this.lastMiniMapKey = mapStr;
      this.miniMapBox.setContent(mapStr);
    }

    const header = ['id', 'on', 'phase', 'mode', 'pos', 'err'];
    this.fleetRowIds = fleet.map((r): string => r.botId);
    this.lastFleetOrder = this.fleetRowIds;
    const rows = fleet.map((r): string[] => {
      const on = r.online ? 'on' : 'off';
      const pos = r.positionLabel === null ? '—' : r.positionLabel;
      const err = r.lastError === null ? '—' : r.lastError.slice(0, 24);
      return [r.botId, on, r.phase, r.modeLabel, pos, err];
    });

    const tableKey = rows.map((r): string => r.join('\x1f')).join('\x1e');
    const sel =
      focusedId.length === 0 ? -1 : this.fleetRowIds.indexOf(focusedId);
    const tableChanged = tableKey !== this.lastTableKey;
    const selChanged = sel !== this.lastSelectedIdx;

    if (tableChanged || selChanged) {
      this.suppressSelectEvent = true;
      if (tableChanged) {
        this.lastTableKey = tableKey;
        this.fleetTable.setData([header, ...rows]);
      }
      if (sel >= 0 && selChanged) this.fleetTable.select(sel);
      this.lastSelectedIdx = sel;
      this.suppressSelectEvent = false;
    }

    const onlineIds = fleet
      .filter((r): boolean => r.online)
      .map((r): string => r.botId);
    const online = onlineIds.length;
    const total = fleet.length;
    const fid = focusedId.length === 0 ? '—' : focusedId;
    const mode = focused === null ? '—' : focused.modeLabel;

    setInputFocusLabel(fid);

    const footerText = ` focus: ${fid} | mode: ${mode} | bots: ${online}/${total} online | log tabs · F1 · F2 · ^K · Tab · ^C `;
    if (footerText !== this.lastFooterText) {
      this.lastFooterText = footerText;
      this.footer.setContent(footerText);
    }
    this.scheduleRender();
  }

  private scheduleRender(): void {
    this.frame.scheduleRender();
  }
}
