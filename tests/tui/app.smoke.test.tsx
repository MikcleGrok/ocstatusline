import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/app';
import { defaultSettings } from '../../src/utils/config';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('App smoke', () => {
  it('shows the main menu and opens the preview', async () => {
    const { lastFrame, stdin } = render(
      <App initialSettings={defaultSettings()} onSave={() => {}} onExit={() => {}} />,
    );
    await delay(30);
    expect(lastFrame()).toContain('ocstatusline config');
    expect(lastFrame()).toContain('Edit line items');
    for (let i = 0; i < 5; i++) { stdin.write('[B'); await delay(10); } // down to "Preview"
    stdin.write('\r'); await delay(30);                                       // enter
    expect(lastFrame()).toContain('qwen3-coder');
  });
});
