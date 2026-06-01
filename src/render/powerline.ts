export function joinPlain(segments: string[], separator: string): string {
  return segments.filter((s) => s && s.length > 0).join(separator);
}

// Phase 1 Powerline: glue segments with the separator glyph. (Per-segment
// fg/bg color transitions are a Plan 1B / later refinement.)
export function joinPowerline(segments: string[], separatorGlyph: string): string {
  return segments.filter((s) => s && s.length > 0).join(separatorGlyph);
}
