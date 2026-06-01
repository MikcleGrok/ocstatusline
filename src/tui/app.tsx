import { useReducer } from 'react';
import { Box, Text, useInput } from 'ink';
import { editorReducer, initialState, type EditorState, type Action } from './state.js';
import type { Settings } from '../types/index.js';
import { MainMenu } from './screens/MainMenu.js';
import { Preview } from './screens/Preview.js';
import { ItemsEditor } from './screens/ItemsEditor.js';
import { ColorMenu } from './screens/ColorMenu.js';

export interface AppProps {
  initialSettings: Settings;
  onSave: (s: Settings) => void;
  onExit: () => void;
}

function ComingSoon({ dispatch }: { dispatch: (a: Action) => void }) {
  useInput((_i, key) => { if (key.escape) dispatch({ t: 'nav', screen: 'menu' }); });
  return (
    <Box flexDirection="column">
      <Text>(screen coming soon)</Text>
      <Text dimColor>Esc back</Text>
    </Box>
  );
}

export function App({ initialSettings, onSave, onExit }: AppProps) {
  const [state, dispatch] = useReducer(editorReducer, initialSettings, initialState);
  switch (state.screen) {
    case 'menu':
      return <MainMenu state={state} dispatch={dispatch} onSave={() => onSave(state.settings)} onExit={onExit} />;
    case 'preview':
      return <Preview state={state} dispatch={dispatch} />;
    case 'items':
      return <ItemsEditor state={state} dispatch={dispatch} />;
    case 'color':
      return <ColorMenu state={state} dispatch={dispatch} />;
    default:
      return <ComingSoon dispatch={dispatch} />;
  }
}
