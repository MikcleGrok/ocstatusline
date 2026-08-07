import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/app';
import { defaultSettings } from '../../src/utils/config';

const DOWN = '[B';

async function waitForFrame(lastFrame: () => string | undefined, text: string, timeoutMs = 1000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = lastFrame() ?? '';
  while (Date.now() < deadline) {
    frame = lastFrame() ?? '';
    if (frame.includes(text)) return frame;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(text)}; last frame:\n${frame}`);
}

describe('App smoke', () => {
  it('shows the main menu and opens the preview', async () => {
    const { lastFrame, stdin } = render(
      <App initialSettings={defaultSettings()} onSave={() => {}} onExit={() => {}} />,
    );
    await waitForFrame(lastFrame, 'ocstatusline config');
    expect(lastFrame()).toContain('ocstatusline config');
    expect(lastFrame()).toContain('Edit line items');
    for (const selection of ['> Powerline setup', '> Lines (add/remove)', '> Settings', '> Preview']) {
      stdin.write(DOWN);
      await waitForFrame(lastFrame, selection);
    }
    stdin.write('\r');
    await waitForFrame(lastFrame, 'qwen3-coder');
  });

  it('color edit lands on the selected widget, not item 0', async () => {
    const { lastFrame, stdin } = render(
      <App initialSettings={defaultSettings()} onSave={() => {}} onExit={() => {}} />,
    );
    await waitForFrame(lastFrame, 'ocstatusline config');
    stdin.write('\r');
    await waitForFrame(lastFrame, 'Line 1 items');
    for (const selection of ['> separator', '> mode', '> separator', '> production-version', '> separator', '> git-branch']) {
      stdin.write(DOWN);
      await waitForFrame(lastFrame, selection);
    }
    stdin.write('e');
    await waitForFrame(lastFrame, 'Color for git-branch');
    stdin.write(DOWN); await waitForFrame(lastFrame, '> black');
    stdin.write(DOWN); await waitForFrame(lastFrame, '> red');
    stdin.write('\r');
    await waitForFrame(lastFrame, 'git-branch [red]');
  });
});
