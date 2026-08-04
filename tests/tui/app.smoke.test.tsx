import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/app';
import { defaultSettings } from '../../src/utils/config';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DOWN = '[B';

describe('App smoke', () => {
  it('shows the main menu and opens the preview', async () => {
    const { lastFrame, stdin } = render(
      <App initialSettings={defaultSettings()} onSave={() => {}} onExit={() => {}} />,
    );
    await delay(30);
    expect(lastFrame()).toContain('ocstatusline config');
    expect(lastFrame()).toContain('Edit line items');
    for (let i = 0; i < 4; i++) { stdin.write(DOWN); await delay(10); } // down to "Preview"
    stdin.write('\r'); await delay(30);                                  // enter
    expect(lastFrame()).toContain('qwen3-coder');
  });

  it('color edit lands on the selected widget, not item 0', async () => {
    const { lastFrame, stdin } = render(
      <App initialSettings={defaultSettings()} onSave={() => {}} onExit={() => {}} />,
    );
    await delay(30);
    stdin.write('\r'); await delay(20);   // Enter "Edit line items" -> items screen
    stdin.write(DOWN); await delay(10);   // item 1 (separator)
    stdin.write(DOWN); await delay(10);   // item 2 (mode)
    stdin.write(DOWN); await delay(10);   // item 3 (separator)
    stdin.write(DOWN); await delay(10);   // item 4 (git-branch)
    stdin.write('e'); await delay(20);    // open ColorMenu (keepItem preserves index 4)
    stdin.write(DOWN); await delay(10);   // color option 1 (black)
    stdin.write(DOWN); await delay(10);   // color option 2 (red)
    stdin.write('\r'); await delay(20);   // set red -> back to items
    expect(lastFrame()).toContain('git-branch [red]');
  });
});
