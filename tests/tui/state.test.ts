import { describe, it, expect } from 'vitest';
import { initialState, editorReducer } from '../../src/tui/state';
import { defaultSettings } from '../../src/utils/config';
import type { Settings } from '../../src/types/index';

function twoLine(): Settings {
  return {
    refreshInterval: 1000, colorLevel: 'truecolor',
    powerline: { enabled: false, separator: '', separatorReverse: '' },
    lines: [
      [{ type: 'model' }, { type: 'cost' }],
      [{ type: 'git-branch' }],
    ],
  };
}

describe('editorReducer', () => {
  it('initialState starts on menu, not dirty', () => {
    const s = initialState(defaultSettings());
    expect(s.screen).toBe('menu');
    expect(s.dirty).toBe(false);
    expect(s.lineIndex).toBe(0);
    expect(s.itemIndex).toBe(0);
  });
  it('nav changes screen and resets itemIndex, stays clean', () => {
    let s = editorReducer(initialState(defaultSettings()), { t: 'cursor', delta: 1, count: 5 });
    s = editorReducer(s, { t: 'nav', screen: 'items' });
    expect(s.screen).toBe('items');
    expect(s.itemIndex).toBe(0);
    expect(s.dirty).toBe(false);
  });
  it('cursor clamps within [0, count-1]', () => {
    let s = initialState(defaultSettings());
    s = editorReducer(s, { t: 'cursor', delta: -1, count: 3 });
    expect(s.itemIndex).toBe(0);
    s = editorReducer(s, { t: 'cursor', delta: 5, count: 3 });
    expect(s.itemIndex).toBe(2);
  });
  it('addItem appends to current line, selects it, marks dirty', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'addItem', widgetType: 'cwd' });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['model', 'cost', 'cwd']);
    expect(s.itemIndex).toBe(2);
    expect(s.dirty).toBe(true);
  });
  it('removeItem drops current widget and clamps cursor', () => {
    let s = { ...initialState(twoLine()), itemIndex: 1 };
    s = editorReducer(s, { t: 'removeItem' });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['model']);
    expect(s.itemIndex).toBe(0);
    expect(s.dirty).toBe(true);
  });
  it('moveItem reorders within the line and follows the item', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'moveItem', delta: 1 });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['cost', 'model']);
    expect(s.itemIndex).toBe(1);
  });
  it('moveItem at boundary is a no-op', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'moveItem', delta: -1 });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['model', 'cost']);
    expect(s.itemIndex).toBe(0);
  });
  it('setColor and toggleBold mutate current widget', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'setColor', color: 'cyan' });
    s = editorReducer(s, { t: 'toggleBold' });
    expect(s.settings.lines[0][0].color).toBe('cyan');
    expect(s.settings.lines[0][0].bold).toBe(true);
    s = editorReducer(s, { t: 'setColor', color: undefined });
    expect(s.settings.lines[0][0].color).toBeUndefined();
  });
  it('setCustomText sets text on custom-text only', () => {
    let s = initialState({ ...twoLine(), lines: [[{ type: 'custom-text' }]] });
    s = editorReducer(s, { t: 'setCustomText', text: 'hi' });
    expect(s.settings.lines[0][0].text).toBe('hi');
  });
  it('setCustomText is a no-op for non-custom widgets', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'setCustomText', text: 'hi' });
    expect(s.settings.lines[0][0].text).toBeUndefined();
    expect(s.dirty).toBe(false);
  });
  it('addLine appends an empty line; removeLine keeps >= 1', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'addLine' });
    expect(s.settings.lines).toHaveLength(3);
    s = editorReducer(s, { t: 'removeLine' });
    expect(s.settings.lines).toHaveLength(2);
  });
  it('removeLine on the last remaining line is a no-op', () => {
    let s = initialState({ ...twoLine(), lines: [[{ type: 'model' }]] });
    s = editorReducer(s, { t: 'removeLine' });
    expect(s.settings.lines).toHaveLength(1);
    expect(s.dirty).toBe(false);
  });
  it('selectLine sets lineIndex and resets itemIndex', () => {
    let s = editorReducer(initialState(twoLine()), { t: 'selectLine', index: 1 });
    expect(s.lineIndex).toBe(1);
    expect(s.itemIndex).toBe(0);
  });
  it('togglePowerline and setSeparator', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'togglePowerline' });
    expect(s.settings.powerline.enabled).toBe(true);
    s = editorReducer(s, { t: 'setSeparator', which: 'sep', value: '>' });
    expect(s.settings.powerline.separator).toBe('>');
    s = editorReducer(s, { t: 'setSeparator', which: 'rev', value: '<' });
    expect(s.settings.powerline.separatorReverse).toBe('<');
  });
  it('setRefresh and setColorLevel', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'setRefresh', ms: 500 });
    s = editorReducer(s, { t: 'setColorLevel', level: 'ansi16' });
    expect(s.settings.refreshInterval).toBe(500);
    expect(s.settings.colorLevel).toBe('ansi16');
  });
  it('does not mutate the input state object', () => {
    const s0 = initialState(twoLine());
    const before = JSON.stringify(s0);
    editorReducer(s0, { t: 'addItem', widgetType: 'cwd' });
    expect(JSON.stringify(s0)).toBe(before);
  });
});
