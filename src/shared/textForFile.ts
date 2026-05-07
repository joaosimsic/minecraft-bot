export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function stripBlessedTags(s: string): string {
  return s.replace(/\{[/#]?[a-z0-9._-]+\}/gi, '');
}

export function sanitizeForFileLine(s: string): string {
  return stripBlessedTags(stripAnsi(s));
}
