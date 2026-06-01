export const RESET = '\x1b[0m';
export function sgr(codes: (string | number)[]): string { return `\x1b[${codes.join(';')}m`; }
// Strip ANSI for width calculations
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Build the escape sequence to repaint a block of `lines`, given how many
// lines the previous paint emitted (the cursor sits at the end of that block).
// Returns to column 0, moves up to the top of the prior block, clears from the
// cursor to the end of the screen (so a shrinking render leaves no leftovers),
// then writes the new lines.
export function repaint(lines: string[], prevLineCount: number): string {
  let out = '\r';
  if (prevLineCount > 1) out += `\x1b[${prevLineCount - 1}A`;
  return out + '\x1b[0J' + lines.join('\n');
}
