const MIN_INNER = 8;
const SPACE_LOOKBACK = 30;

type BoxLike = {
  width: number | string;
  iwidth: number | string;
  scrollbar?: { ch: string };
};

export function blessedDimNumber(v: number | string): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return 0;
}

export function logInnerDisplayWidth(el: BoxLike): number {
  const margin = el.scrollbar !== undefined ? 1 : 0;
  const w = blessedDimNumber(el.width);
  const iw = blessedDimNumber(el.iwidth);
  return Math.max(MIN_INNER, w - iw - margin);
}

export function visibleLenOf(s: string): number {
  let v = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{') {
      const end = s.indexOf('}', i);
      if (end === -1) {
        v += 1;
        i += 1;
        continue;
      }
      i = end + 1;
      continue;
    }
    v += 1;
    i += 1;
  }
  return v;
}

function maxFittingPrefixLength(s: string, inner: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const slice = s.slice(0, mid);
    if (slice.length <= inner && visibleLenOf(slice) <= inner) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function wrapBodyAscii(
  body: string,
  firstBudget: number,
  contBudget: number,
): string[] {
  if (body.length === 0) return [''];
  const out: string[] = [];
  let rest = body;
  let budget = Math.max(1, firstBudget);
  while (true) {
    if (rest.length <= budget) {
      out.push(rest);
      return out;
    }
    let cut = budget;
    const winStart = Math.max(0, cut - SPACE_LOOKBACK);
    const slice = rest.slice(0, cut);
    const sp = slice.lastIndexOf(' ');
    if (sp >= winStart && sp > 0) cut = sp + 1;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
    budget = Math.max(1, contBudget);
  }
}

function wrapGenericLine(line: string, inner: number): string[] {
  if (inner < 1) return [line];
  if (line.length <= inner && visibleLenOf(line) <= inner) return [line];
  const out: string[] = [];
  let rest = line;
  while (true) {
    if (rest.length <= inner && visibleLenOf(rest) <= inner) {
      out.push(rest);
      return out;
    }
    let physCut = maxFittingPrefixLength(rest, inner);
    const winStart = Math.max(0, physCut - SPACE_LOOKBACK);
    const slice = rest.slice(0, physCut);
    const sp = slice.lastIndexOf(' ');
    if (sp >= winStart && sp > 0) physCut = sp + 1;
    if (physCut === 0)
      physCut = Math.max(1, maxFittingPrefixLength(rest, inner));
    out.push(rest.slice(0, physCut));
    rest = rest.slice(physCut).replace(/^\s+/, '');
  }
}

export function wrapUiLogLine(line: string, inner: number): string[] {
  if (inner < MIN_INNER) return [line];

  if (line.indexOf('\n') !== -1) {
    const parts = line.split('\n');
    const out: string[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const raw = parts[i]!;
      const sub = i === 0 ? raw : raw.replace(/^\s+/, '');
      if (sub.length === 0) continue;

      if (i === 0) {
        out.push(...wrapUiLogLine(sub, inner));
        continue;
      }
      out.push(...wrapGenericLine(sub, inner));
    }
    if (out.length === 0) return [''];
    return out;
  }

  const bot = line.match(/^(\[[^\]]+\] )\{([^}]+)\}([\s\S]*)\{\/\2\} (.*)$/);
  if (bot !== null) {
    const g1 = bot[1];
    const tag = bot[2];
    const head = bot[3];
    const body = bot[4];
    if (
      g1 === undefined ||
      tag === undefined ||
      head === undefined ||
      body === undefined
    ) {
      return wrapGenericLine(line, inner);
    }
    const physicalPrefix = `${g1}{${tag}}${head}{/${tag}} `;
    let firstBudget = inner - visibleLenOf(physicalPrefix);
    if (firstBudget < 1) firstBudget = 1;
    const chunks = wrapBodyAscii(body, firstBudget, inner);
    return chunks.map((c, i): string => {
      if (i === 0) return physicalPrefix + c;
      return c;
    });
  }
  const headOnly = line.match(/^\{([^}]+)\}([\s\S]*)\{\/\1\} (.*)$/);
  if (headOnly !== null) {
    const tag = headOnly[1];
    const head = headOnly[2];
    const body = headOnly[3];
    if (tag === undefined || head === undefined || body === undefined) {
      return wrapGenericLine(line, inner);
    }
    const physicalPrefix = `{${tag}}${head}{/${tag}} `;
    let firstBudget = inner - visibleLenOf(physicalPrefix);
    if (firstBudget < 1) firstBudget = 1;
    const chunks = wrapBodyAscii(body, firstBudget, inner);
    return chunks.map((c, i): string => {
      if (i === 0) return physicalPrefix + c;
      return c;
    });
  }
  return wrapGenericLine(line, inner);
}
