import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Settings, SeverityColors } from '../types/index.js';
import type { WeeklyBalanceSeverity } from '../data/openrouter-weekly.js';

export const DEFAULT_SEVERITY_COLORS: SeverityColors = { skyBlue: 75, teal: 37, mutedGreen: 71, orange: 208, darkRed: 124, overBudget: 90 };
const SEVERITY_COLOR_KEYS: Record<Exclude<WeeklyBalanceSeverity, 'neutral'>, keyof SeverityColors> = { 'sky-blue': 'skyBlue', teal: 'teal', 'muted-green': 'mutedGreen', orange: 'orange', 'dark-red': 'darkRed', 'over-budget': 'overBudget' };

export function severityColorCode(severity: WeeklyBalanceSeverity, colors: SeverityColors | undefined): number | undefined {
  return severity === 'neutral' ? undefined : (colors ?? DEFAULT_SEVERITY_COLORS)[SEVERITY_COLOR_KEYS[severity]];
}

export function configPath(): string {
  return path.join(os.homedir(), '.config', 'ocstatusline', 'settings.json');
}

export function defaultSettings(): Settings {
  return {
    refreshInterval: 1000,
    colorLevel: 'truecolor',
    powerline: { enabled: false, separator: '', separatorReverse: '' },
    openrouter: { weeklyBudgetUsd: 25 },
    severityColors: { ...DEFAULT_SEVERITY_COLORS },
    lines: [[
      { type: 'model', color: 'cyan', bold: true },
      { type: 'separator' },
      { type: 'mode', color: 'cyan' },
      { type: 'separator' },
      { type: 'production-version', color: 'green' },
      { type: 'separator' },
      { type: 'git-branch', color: 'magenta' },
      { type: 'separator' },
      { type: 'context-percentage', color: 'yellow' },
      { type: 'separator' },
      { type: 'cost', color: 'green' },
      { type: 'separator' },
      { type: 'session-timer', color: 'blue' },
    ]],
  };
}

function validAnsi256(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function mergeSeverityColors(partial: unknown): SeverityColors {
  const candidate = partial && typeof partial === 'object' ? partial as Partial<SeverityColors> : {};
  return {
    skyBlue: validAnsi256(candidate.skyBlue) ? candidate.skyBlue : DEFAULT_SEVERITY_COLORS.skyBlue,
    teal: validAnsi256(candidate.teal) ? candidate.teal : DEFAULT_SEVERITY_COLORS.teal,
    mutedGreen: validAnsi256(candidate.mutedGreen) ? candidate.mutedGreen : DEFAULT_SEVERITY_COLORS.mutedGreen,
    orange: validAnsi256(candidate.orange) ? candidate.orange : DEFAULT_SEVERITY_COLORS.orange,
    darkRed: validAnsi256(candidate.darkRed) ? candidate.darkRed : DEFAULT_SEVERITY_COLORS.darkRed,
    overBudget: validAnsi256(candidate.overBudget) ? candidate.overBudget : DEFAULT_SEVERITY_COLORS.overBudget,
  };
}

export function mergeSettings(partial: Partial<Settings>): Settings {
  const d = defaultSettings();
  const budget = partial.openrouter?.weeklyBudgetUsd;
  return {
    refreshInterval: partial.refreshInterval ?? d.refreshInterval,
    colorLevel: partial.colorLevel ?? d.colorLevel,
    powerline: { ...d.powerline, ...(partial.powerline ?? {}) },
    openrouter: { weeklyBudgetUsd: typeof budget === 'number' && Number.isFinite(budget) && budget > 0 ? budget : d.openrouter.weeklyBudgetUsd },
    severityColors: mergeSeverityColors(partial.severityColors),
    lines: partial.lines && partial.lines.length ? partial.lines : d.lines,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return mergeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf-8');
}
