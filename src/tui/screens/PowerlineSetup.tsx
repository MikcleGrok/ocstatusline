import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { EditorState, Action } from '../state.js';

export function PowerlineSetup({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [edit, setEdit] = useState<null | 'sep' | 'rev'>(null);
  const pl = state.settings.powerline;
  const rows = [
    `Powerline: ${pl.enabled ? 'on' : 'off'}`,
    `Separator: ${pl.separator || '(none)'}`,
    `Reverse:   ${pl.separatorReverse || '(none)'}`,
  ];

  useInput((_input, key) => {
    if (edit) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: rows.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: rows.length });
    else if (key.return) {
      if (state.itemIndex === 0) dispatch({ t: 'togglePowerline' });
      else setEdit(state.itemIndex === 1 ? 'sep' : 'rev');
    }
  });

  if (edit) {
    return (
      <Box flexDirection="column">
        <Text bold>Set {edit === 'sep' ? 'separator' : 'reverse separator'} glyph</Text>
        <TextPrompt
          label="glyph"
          initial={edit === 'sep' ? pl.separator : pl.separatorReverse}
          onSubmit={(v) => { dispatch({ t: 'setSeparator', which: edit, value: v }); setEdit(null); }}
          onCancel={() => setEdit(null)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Powerline setup</Text>
      <List items={rows} index={state.itemIndex} />
      <Text dimColor>up/down · Enter toggle/edit · Esc back</Text>
    </Box>
  );
}
