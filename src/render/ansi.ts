export const RESET = '\x1b[0m';
export function sgr(codes: (string | number)[]): string { return `\x1b[${codes.join(';')}m`; }
// Strip ANSI for width calculations
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
