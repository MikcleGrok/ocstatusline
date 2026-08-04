import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Settings } from '../types/index.js';

export function configPath(): string {
  return path.join(os.homedir(), '.config', 'ocstatusline', 'settings.json');
}

export function defaultSettings(): Settings {
  return {
    refreshInterval: 1000,
    colorLevel: 'truecolor',
    powerline: { enabled: false, separator: '', separatorReverse: '' },
    openrouter: { weeklyBudgetUsd: 25 },
    lines: [[
      { type: 'model', color: 'cyan', bold: true },
      { type: 'separator' },
      { type: 'mode', color: 'cyan' },
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

export function mergeSettings(partial: Partial<Settings>): Settings {
  const d = defaultSettings();
  const budget = partial.openrouter?.weeklyBudgetUsd;
  return {
    refreshInterval: partial.refreshInterval ?? d.refreshInterval,
    colorLevel: partial.colorLevel ?? d.colorLevel,
    powerline: { ...d.powerline, ...(partial.powerline ?? {}) },
    openrouter: { weeklyBudgetUsd: typeof budget === 'number' && Number.isFinite(budget) && budget > 0 ? budget : d.openrouter.weeklyBudgetUsd },
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
