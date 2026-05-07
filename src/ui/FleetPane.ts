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
  private lastStatusKey = '';

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
    this.focusedBox.setContent(focusLines.join('\n'));

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
    this.fleetTable.setData([header, ...rows]);

    const sel =
      focusedId.length === 0 ? -1 : this.fleetRowIds.indexOf(focusedId);
    if (sel >= 0) this.fleetTable.select(sel);

    const onlineIds = fleet
      .filter((r): boolean => r.online)
      .map((r): string => r.botId);
    const online = onlineIds.length;
    const total = fleet.length;
    const fid = focusedId.length === 0 ? '—' : focusedId;
    const mode = focused === null ? '—' : focused.modeLabel;

    setInputFocusLabel(fid);

    const nextKey = `${fid}\n${mode}\n${online}\n${total}\n${focusLines.join('|')}\n${rows.join(';')}`;
    if (nextKey !== this.lastStatusKey) {
      this.lastStatusKey = nextKey;
      this.footer.setContent(
        ` focus: ${fid} | mode: ${mode} | bots: ${online}/${total} online | log tabs · F1 · F2 · ^K · Tab · ^C `,
      );
      this.scheduleRender();
      return;
    }
    this.scheduleRender();
  }

  private scheduleRender(): void {
    this.frame.scheduleRender();
  }
}
