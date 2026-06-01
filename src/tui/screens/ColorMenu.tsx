import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { EditorState, Action } from '../state.js';

const NAMED = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const OPTIONS = ['(none)', ...NAMED, 'custom hex...'];

export function ColorMenu({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [index, setIndex] = useState(0);
  const [hexMode, setHexMode] = useState(false);
  const [error, setError] = useState('');
  const w = state.settings.lines[state.lineIndex]?.[state.itemIndex];

  useInput((input, key) => {
    if (hexMode) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'items', keepItem: true });
    else if (key.upArrow) setIndex(Math.max(0, index - 1));
    else if (key.downArrow) setIndex(Math.min(OPTIONS.length - 1, index + 1));
    else if (input === 'b') dispatch({ t: 'toggleBold' });
    else if (key.return) {
      const choice = OPTIONS[index];
      if (choice === '(none)') { dispatch({ t: 'setColor', color: undefined }); dispatch({ t: 'nav', screen: 'items', keepItem: true }); }
      else if (choice === 'custom hex...') { setError(''); setHexMode(true); }
      else { dispatch({ t: 'setColor', color: choice }); dispatch({ t: 'nav', screen: 'items', keepItem: true }); }
    }
  });

  if (hexMode) {
    return (
      <Box flexDirection="column">
        <Text bold>Hex color</Text>
        {error ? <Text color="red">{error}</Text> : null}
        <TextPrompt
          label="#rrggbb"
          initial=""
          onSubmit={(v) => {
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
              dispatch({ t: 'setColor', color: v.startsWith('#') ? v : '#' + v });
              dispatch({ t: 'nav', screen: 'items', keepItem: true });
            } else { setError('invalid hex (expected #rrggbb)'); }
          }}
          onCancel={() => setHexMode(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Color for {w ? w.type : '(no widget)'} {w?.bold ? '(bold)' : ''}</Text>
      <List items={OPTIONS} index={index} />
      <Text dimColor>up/down · Enter set · b toggle bold · Esc back</Text>
    </Box>
  );
}
