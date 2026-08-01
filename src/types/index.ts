export interface TokenSet {
  input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total?: number;
}
export interface MsgAgg {
  role: string; cost: number; tokens: TokenSet;
  contextTokens?: number;
  modelID?: string; providerID?: string; mode?: string; cwd?: string; created: number;
}
export interface OpencodeState {
  connected: boolean;
  idle: boolean;
  byMessage: Record<string, MsgAgg>;
  latestAssistantID: string | null;
  sessionStart: number | null;
  lastUpdate: number;
}
export interface Derived {
  model: string | null; provider: string | null; mode: string | null; cwd: string | null;
  totalTokens: number; contextTokens: number; contextLimit: number | null; cost: number;
  sessionDurationMs: number;
}
export interface GitInfo {
  isRepo: boolean; branch: string | null; dirty: boolean;
  ahead: number; behind: number; changes: number; sha: string | null;
}
export interface RenderContext {
  state: OpencodeState;
  derived: Derived;
  git: GitInfo;
  termWidth: number;
  now: number;
}
export type ColorLevel = 'ansi16' | 'ansi256' | 'truecolor';
export interface WidgetConfig {
  type: string;
  color?: string;     // name (e.g. "cyan") or hex (e.g. "#88c0d0")
  bold?: boolean;
  [k: string]: unknown;
}
export interface Widget {
  type: string;
  label: string;
  render(ctx: RenderContext, cfg: WidgetConfig): string | null; // null/"" → hidden
}
export interface PowerlineConfig {
  enabled: boolean;
  separator: string;      // e.g. powerline separator glyph
  separatorReverse: string; // e.g. powerline reverse separator glyph
}
export interface Settings {
  lines: WidgetConfig[][];
  refreshInterval: number; // ms
  colorLevel: ColorLevel;
  powerline: PowerlineConfig;
}
export function emptyState(): OpencodeState {
  return { connected: false, idle: true, byMessage: {}, latestAssistantID: null, sessionStart: null, lastUpdate: 0 };
}
export function zeroTokens(): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}
