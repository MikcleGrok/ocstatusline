import { Box, Text, useInput } from 'ink';
import { List } from '../components.js';
import type { EditorState, Action, Screen } from '../state.js';

const MENU: { label: string; screen?: Screen; save?: boolean }[] = [
  { label: 'Edit line items', screen: 'items' },
  { label: 'Colors', screen: 'items' },
  { label: 'Powerline setup', screen: 'powerline' },
  { label: 'Lines (add/remove)', screen: 'lines' },
  { label: 'Settings', screen: 'settings' },
  { label: 'Preview', screen: 'preview' },
  { label: 'Save & exit', save: true },
];

export function MainMenu({ state, dispatch, onSave, onExit }: {
  state: EditorState; dispatch: (a: Action) => void; onSave: () => void; onExit: () => void;
}) {
  useInput((input, key) => {
    if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: MENU.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: MENU.length });
    else if (key.return) {
      const item = MENU[state.itemIndex];
      if (item.screen) dispatch({ t: 'nav', screen: item.screen });
      else if (item.save) { onSave(); onExit(); }
    } else if (input === 'q') onExit();
  });
  return (
    <Box flexDirection="column">
      <Text bold>ocstatusline config{state.dirty ? ' *' : ''}</Text>
      <List items={MENU.map((m) => m.label)} index={state.itemIndex} />
      <Text dimColor>up/down move · Enter select · q quit</Text>
    </Box>
  );
}
