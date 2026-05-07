function parseDoubleQuoted(s: string): [string | null, string | null] {
  if (!s.startsWith('"')) return ['expected opening quote', null];

  let i = 1;
  let out = '';
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\') {
      const n = s[i + 1];
      if (n === undefined) return ['unterminated escape in macro string', null];
      out += n;
      i += 2;
      continue;
    }
    if (c === '"') {
      const tail = s.slice(i + 1).trim();
      if (tail.length > 0) return ['trailing text after macro string', null];
      return [null, out];
    }
    out += c;
    i += 1;
  }

  return ['unterminated string in :save', null];
}

export function parseSaveMacroLine(
  line: string,
): [string | null, { name: string; body: string } | null] {
  const head = ':save ';
  if (!line.startsWith(head)) return ['usage: :save <name> "cmd; cmd"', null];

  let rest = line.slice(head.length).trimStart();
  const nameMatch = rest.match(/^[\w-]+/);
  if (nameMatch === null) return ['usage: :save <name> "cmd; cmd"', null];

  const name = nameMatch[0]!;
  rest = rest.slice(name.length).trimStart();
  if (!rest.startsWith('"')) return ['usage: :save <name> "cmd; cmd"', null];

  const [qe, body] = parseDoubleQuoted(rest);
  if (qe !== null) return [qe, null];
  return [null, { name, body: body! }];
}

export function parseRunMacroLine(
  line: string,
): [string | null, string | null] {
  const head = ':run ';
  if (!line.startsWith(head)) return ['usage: :run <name>', null];

  const name = line.slice(head.length).trim();
  if (name.length === 0) return ['usage: :run <name>', null];
  if (!/^[\w-]+$/.test(name)) return ['usage: :run <name>', null];

  return [null, name];
}

export function splitMacroSteps(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.split(';')) {
    const t = raw.trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}
