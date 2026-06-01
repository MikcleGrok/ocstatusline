import { Box, Text, useInput } from 'ink';
import { List } from '../components.js';
import type { EditorState, Action } from '../state.js';

export function LineSelector({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const lines = state.settings.lines;
  useInput((input, key) => {
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'selectLine', index: state.lineIndex - 1 });
    else if (key.downArrow) dispatch({ t: 'selectLine', index: state.lineIndex + 1 });
    else if (input === 'a') dispatch({ t: 'addLine' });
    else if (input === 'd') dispatch({ t: 'removeLine' });
    else if (key.return) dispatch({ t: 'nav', screen: 'items' });
  });
  const items = lines.map((line, i) => `Line ${i + 1}: ${line.map((w) => w.type).join(', ') || '(empty)'}`);
  return (
    <Box flexDirection="column">
      <Text bold>Lines</Text>
      <List items={items} index={state.lineIndex} />
      <Text dimColor>up/down select · a add · d remove · Enter edit items · Esc back</Text>
    </Box>
  );
}
