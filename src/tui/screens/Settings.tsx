import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { ColorLevel } from '../../types/index.js';
import type { EditorState, Action } from '../state.js';

const LEVELS: ColorLevel[] = ['ansi16', 'ansi256', 'truecolor'];

export function SettingsScreen({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [editRefresh, setEditRefresh] = useState(false);
  const { refreshInterval, colorLevel } = state.settings;
  const rows = [`Refresh interval (ms): ${refreshInterval}`, `Color level: ${colorLevel}`];

  useInput((_input, key) => {
    if (editRefresh) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: rows.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: rows.length });
    else if (key.return) {
      if (state.itemIndex === 0) setEditRefresh(true);
      else {
        const next = LEVELS[(LEVELS.indexOf(colorLevel) + 1) % LEVELS.length];
        dispatch({ t: 'setColorLevel', level: next });
      }
    }
  });

  if (editRefresh) {
    return (
      <Box flexDirection="column">
        <Text bold>Refresh interval (ms)</Text>
        <TextPrompt
          label="ms"
          initial={String(refreshInterval)}
          onSubmit={(v) => { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) dispatch({ t: 'setRefresh', ms: n }); setEditRefresh(false); }}
          onCancel={() => setEditRefresh(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <List items={rows} index={state.itemIndex} />
      <Text dimColor>up/down · Enter edit/cycle · Esc back</Text>
    </Box>
  );
}
