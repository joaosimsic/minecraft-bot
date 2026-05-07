import { REPL_COMMAND_HEADS } from './replCommands';

export type PaletteScoreRow = { item: string; score: number };

export function buildOrderedPaletteCandidates(
  ids: string[],
  macroNames: readonly string[] = [],
): string[] {
  const sid = [...new Set(ids)].sort((a, b): number => a.localeCompare(b));
  const atIds = sid.map((id): string => `@${id}`);
  const runs = [...new Set(macroNames)]
    .sort((a, b): number => a.localeCompare(b))
    .map((m): string => `:run ${m}`);
  return [...REPL_COMMAND_HEADS, '@all', ...atIds, ...sid, ...runs];
}

export function scorePaletteMatch(
  query: string,
  item: string,
): PaletteScoreRow | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return null;

  const s = item.toLowerCase();
  const idx = s.indexOf(q);
  if (idx !== -1) return { item, score: 1000 + (200 - idx) };

  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (qi >= q.length) break;

    const qc = q[qi];
    const sc = s[i];
    if (qc === undefined || sc === undefined) break;

    if (sc !== qc) {
      streak = 0;
      continue;
    }

    score += 8 + streak * 4;
    streak += 1;
    qi += 1;
  }

  if (qi < q.length) return null;

  return { item, score };
}

export function rankPaletteCandidates(
  query: string,
  ordered: string[],
): string[] {
  const q = query.trim();
  if (q.length === 0) return ordered.slice(0, 48);

  const rows: PaletteScoreRow[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const item = ordered[i];
    if (item === undefined) continue;

    const row = scorePaletteMatch(q, item);
    if (row === null) continue;

    rows.push(row);
  }

  rows.sort((a, b): number => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.localeCompare(b.item);
  });

  const out: string[] = [];
  const max = Math.min(rows.length, 48);
  for (let i = 0; i < max; i += 1) {
    const r = rows[i];
    if (r !== undefined) out.push(r.item);
  }

  return out;
}
