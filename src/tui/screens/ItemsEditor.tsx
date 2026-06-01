import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import { availableWidgets } from '../widget-catalog.js';
import type { EditorState, Action } from '../state.js';

type Mode = 'list' | 'add' | 'text';

export function ItemsEditor({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [mode, setMode] = useState<Mode>('list');
  const [addIndex, setAddIndex] = useState(0);
  const line = state.settings.lines[state.lineIndex] ?? [];
  const catalog = availableWidgets();

  useInput((input, key) => {
    if (mode !== 'list') return; // sub-modes own their input below
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: line.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: line.length });
    else if (input === '<') dispatch({ t: 'moveItem', delta: -1 });
    else if (input === '>') dispatch({ t: 'moveItem', delta: 1 });
    else if (input === 'd') dispatch({ t: 'removeItem' });
    else if (input === 'a') { setAddIndex(0); setMode('add'); }
    else if (input === 'e' || key.return) {
      const w = line[state.itemIndex];
      if (!w) return; // empty line: nothing to edit
      if (w.type === 'custom-text' || w.type === 'custom-symbol') setMode('text');
      else dispatch({ t: 'nav', screen: 'color', keepItem: true });
    }
  });

  if (mode === 'add') {
    return (
      <Box flexDirection="column">
        <Text bold>Add widget (Line {state.lineIndex + 1})</Text>
        <AddPicker
          catalog={catalog}
          index={addIndex}
          setIndex={setAddIndex}
          onPick={(type) => { dispatch({ t: 'addItem', widgetType: type }); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </Box>
    );
  }
  if (mode === 'text') {
    const w = line[state.itemIndex];
    const initial = (typeof w?.text === 'string' ? w.text : typeof w?.symbol === 'string' ? w.symbol : '') as string;
    return (
      <Box flexDirection="column">
        <Text bold>Edit text</Text>
        <TextPrompt
          label="text"
          initial={initial}
          onSubmit={(v) => { dispatch({ t: 'setCustomText', text: v }); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Line {state.lineIndex + 1} items</Text>
      <List items={line.length ? line.map((w) => w.type + (w.color ? ` [${w.color}]` : '') + (w.bold ? ' b' : '')) : ['(empty)']} index={state.itemIndex} />
      <Text dimColor>up/down · a add · d del · &lt;/&gt; move · e color/text · Esc back</Text>
    </Box>
  );
}

function AddPicker({ catalog, index, setIndex, onPick, onCancel }: {
  catalog: { type: string; label: string }[];
  index: number; setIndex: (n: number) => void;
  onPick: (type: string) => void; onCancel: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.upArrow) setIndex(Math.max(0, index - 1));
    else if (key.downArrow) setIndex(Math.min(catalog.length - 1, index + 1));
    else if (key.return) onPick(catalog[index].type);
  });
  return <List items={catalog.map((c) => `${c.label} (${c.type})`)} index={index} />;
}
