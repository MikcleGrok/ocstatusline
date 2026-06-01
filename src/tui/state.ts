import type { Settings, WidgetConfig, ColorLevel } from '../types/index.js';

export type Screen = 'menu' | 'lines' | 'items' | 'color' | 'powerline' | 'settings' | 'preview';

export interface EditorState {
  settings: Settings;
  screen: Screen;
  lineIndex: number;
  itemIndex: number;
  dirty: boolean;
}

export type Action =
  | { t: 'nav'; screen: Screen; keepItem?: boolean }
  | { t: 'cursor'; delta: number; count: number }
  | { t: 'moveItem'; delta: number }
  | { t: 'addItem'; widgetType: string }
  | { t: 'removeItem' }
  | { t: 'setColor'; color?: string }
  | { t: 'toggleBold' }
  | { t: 'setCustomText'; text: string }
  | { t: 'addLine' }
  | { t: 'removeLine' }
  | { t: 'selectLine'; index: number }
  | { t: 'togglePowerline' }
  | { t: 'setSeparator'; which: 'sep' | 'rev'; value: string }
  | { t: 'setRefresh'; ms: number }
  | { t: 'setColorLevel'; level: ColorLevel };

export function initialState(settings: Settings): EditorState {
  return { settings, screen: 'menu', lineIndex: 0, itemIndex: 0, dirty: false };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

function patchLine(s: EditorState, fn: (line: WidgetConfig[]) => WidgetConfig[]): Settings {
  const lines = s.settings.lines.map((line, i) => (i === s.lineIndex ? fn(line) : line));
  return { ...s.settings, lines };
}

function patchWidget(s: EditorState, fn: (w: WidgetConfig) => WidgetConfig): Settings {
  return patchLine(s, (line) => line.map((w, i) => (i === s.itemIndex ? fn(w) : w)));
}

export function editorReducer(s: EditorState, a: Action): EditorState {
  switch (a.t) {
    case 'nav':
      return { ...s, screen: a.screen, itemIndex: a.keepItem ? s.itemIndex : 0 };
    case 'cursor':
      return { ...s, itemIndex: clamp(s.itemIndex + a.delta, 0, Math.max(0, a.count - 1)) };
    case 'moveItem': {
      const line = s.settings.lines[s.lineIndex];
      const j = s.itemIndex + a.delta;
      if (j < 0 || j >= line.length) return s;
      const next = line.slice();
      [next[s.itemIndex], next[j]] = [next[j], next[s.itemIndex]];
      return { ...s, settings: patchLine(s, () => next), itemIndex: j, dirty: true };
    }
    case 'addItem': {
      const settings = patchLine(s, (line) => [...line, { type: a.widgetType }]);
      const len = settings.lines[s.lineIndex].length;
      return { ...s, settings, itemIndex: len - 1, dirty: true };
    }
    case 'removeItem': {
      const settings = patchLine(s, (line) => line.filter((_, i) => i !== s.itemIndex));
      const len = settings.lines[s.lineIndex].length;
      return { ...s, settings, itemIndex: clamp(s.itemIndex, 0, Math.max(0, len - 1)), dirty: true };
    }
    case 'setColor':
      return { ...s, settings: patchWidget(s, (w) => ({ ...w, color: a.color })), dirty: true };
    case 'toggleBold':
      return { ...s, settings: patchWidget(s, (w) => ({ ...w, bold: !w.bold })), dirty: true };
    case 'setCustomText': {
      const w = s.settings.lines[s.lineIndex]?.[s.itemIndex];
      if (!w || (w.type !== 'custom-text' && w.type !== 'custom-symbol')) return s;
      const key = w.type === 'custom-text' ? 'text' : 'symbol';
      return { ...s, settings: patchWidget(s, (cur) => ({ ...cur, [key]: a.text })), dirty: true };
    }
    case 'addLine':
      return { ...s, settings: { ...s.settings, lines: [...s.settings.lines, []] }, dirty: true };
    case 'removeLine': {
      if (s.settings.lines.length <= 1) return s;
      const lines = s.settings.lines.filter((_, i) => i !== s.lineIndex);
      return { ...s, settings: { ...s.settings, lines }, lineIndex: clamp(s.lineIndex, 0, lines.length - 1), itemIndex: 0, dirty: true };
    }
    case 'selectLine':
      return { ...s, lineIndex: clamp(a.index, 0, s.settings.lines.length - 1), itemIndex: 0 };
    case 'togglePowerline':
      return { ...s, settings: { ...s.settings, powerline: { ...s.settings.powerline, enabled: !s.settings.powerline.enabled } }, dirty: true };
    case 'setSeparator': {
      const key = a.which === 'sep' ? 'separator' : 'separatorReverse';
      return { ...s, settings: { ...s.settings, powerline: { ...s.settings.powerline, [key]: a.value } }, dirty: true };
    }
    case 'setRefresh':
      return { ...s, settings: { ...s.settings, refreshInterval: a.ms }, dirty: true };
    case 'setColorLevel':
      return { ...s, settings: { ...s.settings, colorLevel: a.level }, dirty: true };
  }
}
