import { Box, Text, useInput } from 'ink';
import { renderLines } from '../../render/renderer.js';
import { mockContext } from '../preview-context.js';
import type { EditorState, Action } from '../state.js';

export function Preview({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) dispatch({ t: 'nav', screen: 'menu' });
  });
  const lines = renderLines(mockContext(), state.settings);
  return (
    <Box flexDirection="column">
      <Text bold>Preview (sample data)</Text>
      {lines.map((l, i) => <Text key={i}>{l}</Text>)}
      <Text dimColor>Esc back</Text>
    </Box>
  );
}
