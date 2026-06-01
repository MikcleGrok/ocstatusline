import * as path from 'path';
import type { Widget, RenderContext, WidgetConfig } from '../types/index.js';

export function fmtK(n: number): string {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m${String(sec).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

const widgets: Widget[] = [
  { type: 'model', label: 'Model', render: (c) => c.derived.model ? c.derived.model.replace(/\s*\(.*context\)$/i, '') : null },
  { type: 'provider', label: 'Provider', render: (c) => c.derived.provider },
  { type: 'mode', label: 'Agent/Mode', render: (c) => c.derived.mode },
  { type: 'cost', label: 'Cost', render: (c) => c.derived.cost > 0 ? `$${c.derived.cost.toFixed(2)}` : '$0.00' },
  { type: 'tokens', label: 'Tokens (total)', render: (c) => fmtK(c.derived.totalTokens) },
  { type: 'context-length', label: 'Context Length', render: (c) => fmtK(c.derived.contextTokens) },
  {
    type: 'context-percentage', label: 'Context %',
    render: (c) => c.derived.contextLimit ? `ctx ${Math.round((c.derived.contextTokens / c.derived.contextLimit) * 100)}%` : null,
  },
  {
    type: 'context-bar', label: 'Context Bar',
    render: (c) => {
      if (!c.derived.contextLimit) return null;
      const pct = Math.min(1, c.derived.contextTokens / c.derived.contextLimit);
      const width = 10;
      const filled = Math.round(pct * width);
      return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
    },
  },
  { type: 'context-window', label: 'Context Window', render: (c) => c.derived.contextLimit ? fmtK(c.derived.contextLimit) : null },
  { type: 'session-timer', label: 'Session Timer', render: (c) => c.derived.sessionDurationMs > 0 ? fmtDuration(c.derived.sessionDurationMs) : null },
  { type: 'git-branch', label: 'Git Branch', render: (c) => c.git.isRepo && c.git.branch ? c.git.branch + (c.git.dirty ? '*' : '') : null },
  { type: 'git-clean-status', label: 'Git Clean Status', render: (c) => c.git.isRepo ? (c.git.dirty ? 'dirty' : 'clean') : null },
  {
    type: 'git-ahead-behind', label: 'Git Ahead/Behind',
    render: (c) => {
      if (!c.git.isRepo) return null;
      const parts: string[] = [];
      if (c.git.ahead) parts.push(`↑${c.git.ahead}`);
      if (c.git.behind) parts.push(`↓${c.git.behind}`);
      return parts.length ? parts.join(' ') : null;
    },
  },
  { type: 'git-changes', label: 'Git Changes', render: (c) => c.git.isRepo && c.git.changes ? `±${c.git.changes}` : null },
  { type: 'git-sha', label: 'Git SHA', render: (c) => c.git.isRepo ? c.git.sha : null },
  { type: 'cwd', label: 'Working Dir', render: (c) => c.derived.cwd ? path.basename(c.derived.cwd) : null },
  { type: 'custom-text', label: 'Custom Text', render: (_c, cfg) => (typeof cfg.text === 'string' ? cfg.text : '') },
  { type: 'custom-symbol', label: 'Custom Symbol', render: (_c, cfg) => (typeof cfg.symbol === 'string' ? cfg.symbol : '') },
  // separator is handled by the renderer, but register a no-render placeholder
  { type: 'separator', label: 'Separator', render: () => null },
];

export const WIDGETS: Record<string, Widget> = Object.fromEntries(widgets.map((w) => [w.type, w]));
