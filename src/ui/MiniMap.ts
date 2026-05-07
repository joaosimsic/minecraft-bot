export type MiniMapBot = {
  id: string;
  mapX: number;
  mapZ: number;
  online: boolean;
  focused: boolean;
};

export type MiniMapParams = {
  cols: number;
  rows: number;
  homeX: number | null;
  homeZ: number | null;
  bots: MiniMapBot[];
};

type Owner = MiniMapBot | 'home' | null;

export class MiniMapFormatter {
  public static render(p: MiniMapParams): string {
    if (p.cols < 1 || p.rows < 1) return '';

    const xs: number[] = [];
    const zs: number[] = [];
    if (p.homeX !== null && p.homeZ !== null) {
      xs.push(p.homeX);
      zs.push(p.homeZ);
    }
    for (const b of p.bots) {
      xs.push(b.mapX);
      zs.push(b.mapZ);
    }
    if (xs.length === 0) return '{gray-fg}no pos{/gray-fg}';

    let minX = xs[0]!;
    let maxX = xs[0]!;
    let minZ = zs[0]!;
    let maxZ = zs[0]!;
    for (let i = 1; i < xs.length; i += 1) {
      const x = xs[i]!;
      const z = zs[i]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const pad = 2 + Math.max((maxX - minX) * 0.08, (maxZ - minZ) * 0.08);
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;
    if (maxX <= minX) maxX = minX + 1;
    if (maxZ <= minZ) maxZ = minZ + 1;

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    const grid: string[][] = [];
    const owner: Owner[][] = [];
    for (let r = 0; r < p.rows; r += 1) {
      const row: string[] = [];
      const orow: Owner[] = [];
      for (let c = 0; c < p.cols; c += 1) {
        row.push('.');
        orow.push(null);
      }
      grid.push(row);
      owner.push(orow);
    }

    const cellFor = (x: number, z: number): [number, number] => {
      const c = Math.min(
        p.cols - 1,
        Math.max(0, Math.floor(((x - minX) / spanX) * p.cols)),
      );
      const r = Math.min(
        p.rows - 1,
        Math.max(0, Math.floor(((z - minZ) / spanZ) * p.rows)),
      );
      return [c, r];
    };

    if (p.homeX !== null && p.homeZ !== null) {
      const [hc, hr] = cellFor(p.homeX, p.homeZ);
      grid[hr]![hc] = '+';
      owner[hr]![hc] = 'home';
    }

    const sorted = [...p.bots].sort((a, b): number => {
      if (a.focused === b.focused) return 0;
      if (a.focused) return 1;
      return -1;
    });

    for (const b of sorted) {
      const sym = MiniMapFormatter.glyph(b.id);
      const [bc, br] = cellFor(b.mapX, b.mapZ);
      const cur = grid[br]![bc]!;
      const o = owner[br]![bc]!;
      if (cur === '.' || cur === '+') {
        grid[br]![bc] = sym;
        owner[br]![bc] = b;
        continue;
      }
      if (o === 'home') {
        grid[br]![bc] = sym;
        owner[br]![bc] = b;
        continue;
      }
      if (typeof o === 'object' && o.id === b.id) continue;
      grid[br]![bc] = '*';
      owner[br]![bc] = null;
    }

    const lines: string[] = [];
    for (let r = 0; r < p.rows; r += 1) {
      let rowStr = '';
      for (let c = 0; c < p.cols; c += 1) {
        rowStr += MiniMapFormatter.fmtCell(grid[r]![c]!, owner[r]![c]!);
      }
      lines.push(rowStr);
    }
    return lines.join('\n');
  }

  private static glyph(id: string): string {
    const t = id.trim();
    const ch = t[0];
    if (ch === undefined) return '?';
    const lower = ch.toLowerCase();
    if (lower >= 'a' && lower <= 'z') return lower.toUpperCase();
    return ch;
  }

  private static fmtCell(sym: string, o: Owner): string {
    if (sym === '*') return '{yellow-fg}*{/yellow-fg}';
    if (sym === '.') return '{gray-fg}.{/gray-fg}';
    if (o === 'home') return '{yellow-fg}+{/yellow-fg}';
    if (o === null) return sym;
    if (!o.online) return `{gray-fg}${sym}{/gray-fg}`;
    if (o.focused) return `{cyan-fg}${sym}{/cyan-fg}`;
    return sym;
  }
}
