import { stripAnsi } from './ansi.js';

export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

export function fitWidth(line: string, max: number): string {
  if (visibleWidth(line) <= max) return line;
  // Truncate on the visible (stripped) text; drop ANSI to keep it simple/correct.
  const plain = stripAnsi(line);
  if (max <= 1) return '…'.slice(0, Math.max(0, max));
  return plain.slice(0, max - 1) + '…';
}
