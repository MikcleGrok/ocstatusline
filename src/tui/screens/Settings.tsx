import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { ColorLevel } from '../../types/index.js';
import type { EditorState, Action } from '../state.js';

const LEVELS: ColorLevel[] = ['ansi16', 'ansi256', 'truecolor'];

export function SettingsScreen({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [editRefresh, setEditRefresh] = useState(false);
  const [editBudget, setEditBudget] = useState(false);
  const { refreshInterval, colorLevel, openrouter } = state.settings;
  const rows = [`Refresh interval (ms): ${refreshInterval}`, `Color level: ${colorLevel}`, `OpenRouter weekly budget (USD): ${openrouter.weeklyBudgetUsd}`];

  useInput((_input, key) => {
    if (editRefresh || editBudget) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: rows.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: rows.length });
    else if (key.return) {
      if (state.itemIndex === 0) setEditRefresh(true);
      else if (state.itemIndex === 1) {
        const next = LEVELS[(LEVELS.indexOf(colorLevel) + 1) % LEVELS.length];
        dispatch({ t: 'setColorLevel', level: next });
      } else setEditBudget(true);
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

  if (editBudget) return <Box flexDirection="column"><Text bold>OpenRouter weekly budget (USD)</Text><TextPrompt label="USD" initial={String(openrouter.weeklyBudgetUsd)} onSubmit={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) dispatch({ t: 'setWeeklyBudget', usd: n }); setEditBudget(false); }} onCancel={() => setEditBudget(false)} /></Box>;

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <List items={rows} index={state.itemIndex} />
      <Text dimColor>up/down · Enter edit/cycle · Esc back</Text>
    </Box>
  );
}
