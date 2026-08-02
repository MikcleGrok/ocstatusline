import type { RenderContext, Settings, WidgetConfig } from '../types/index.js';
import { WIDGETS } from '../widgets/index.js';
import { colorize } from './colors.js';
import { joinPlain, joinPowerline } from './powerline.js';
import { fitWidth } from './flex.js';
import { weeklyBalanceSeverity } from '../data/openrouter-weekly.js';

const DEFAULT_SEP = ' · ';

function renderWidget(ctx: RenderContext, cfg: WidgetConfig, settings: Settings): string | null {
  const w = WIDGETS[cfg.type];
  if (!w) return null;
  const raw = w.render(ctx, cfg);
  if (raw === null || raw === '') return null;
  const severity = cfg.type === 'openrouter-weekly' ? weeklyBalanceSeverity(ctx.openrouterWeekly) : 'normal';
  const dynamic = cfg.type === 'openrouter-weekly' ? (severity === 'critical' ? 124 : severity === 'warning' ? 33 : undefined) : undefined;
  return colorize(raw, { color: dynamic ?? cfg.color, bold: cfg.bold }, settings.colorLevel);
}

export function renderLine(ctx: RenderContext, line: WidgetConfig[], settings: Settings): string {
  // Split on explicit separator widgets into groups, render each group's widgets,
  // then join non-empty rendered widgets with the active separator.
  const rendered: string[] = [];
  for (const cfg of line) {
    if (cfg.type === 'separator') continue; // separators are implicit between widgets
    const out = renderWidget(ctx, cfg, settings);
    if (out) rendered.push(out);
  }
  const joined = settings.powerline.enabled
    ? joinPowerline(rendered, settings.powerline.separator)
    : joinPlain(rendered, DEFAULT_SEP);
  return fitWidth(joined, ctx.termWidth);
}

export function renderLines(ctx: RenderContext, settings: Settings): string[] {
  return settings.lines.map((line) => renderLine(ctx, line, settings));
}
