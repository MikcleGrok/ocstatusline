import { stripAnsi } from '../../src/render/ansi';

export function normalizeLine(line: string): string {
  return stripAnsi(line)
    .replace(/\d+h\d{2}m/g, '<timer>')
    .replace(/\d+m\d{2}s/g, '<timer>');
}