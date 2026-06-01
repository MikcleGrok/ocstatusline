import { render } from 'ink';
import { loadSettings, saveSettings } from '../utils/config.js';
import { App } from './app.js';
import type { Settings } from '../types/index.js';

export async function mountTui(): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write('ocstatusline: config TUI needs an interactive terminal. Run "ocstatusline start" to launch the daemon.\n');
    process.exit(0);
  }
  const initialSettings = loadSettings();
  const onSave = (s: Settings) => {
    try { saveSettings(s); }
    catch (e) { process.stderr.write(`ocstatusline: save failed: ${(e as Error).message}\n`); }
  };
  let inst: ReturnType<typeof render>;
  const onExit = () => inst.unmount();
  inst = render(<App initialSettings={initialSettings} onSave={onSave} onExit={onExit} />);
  await inst.waitUntilExit();
}
