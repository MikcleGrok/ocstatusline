import { describe, it } from 'vitest';
import { VERSION } from '../../src/version.js';
import { runCli } from '../support/act.js';
import { expectCli } from '../support/assert.js';

const bunOnly = describe.skipIf(typeof Bun === 'undefined');

bunOnly('CLI process contract', () => {
  it('serves help and version through the public entry point', async () => {
    expectCli(await runCli(['--help']), { exitCode: 0, stdout: 'Usage: ocstatusline' });
    expectCli(await runCli(['--version']), { exitCode: 0, stdout: `${VERSION}\n` });
    expectCli(await runCli(['-v']), { exitCode: 0, stdout: `${VERSION}\n` });
  });

  it('renders stdin JSON and closes on EOF', async () => {
    const result = await runCli(['render', '--stdin'], JSON.stringify({ version: 1, model: 'cli-model', termWidth: 120 }));
    expectCli(result, { exitCode: 0, stdout: 'cli-model' });
    if (!result.stdout.endsWith('\n')) throw new Error('render --stdin must end with a newline');
    if (/\x1b\[/.test(result.stdout)) throw new Error('render --stdin must be plain text');
  });

  it('reports malformed public invocations on stderr', async () => {
    expectCli(await runCli(['render']), { exitCode: 1, stderr: 'render requires exactly --stdin' });
    expectCli(await runCli(['render', '--stdin'], '{bad json'), { exitCode: 1, stderr: 'ocstatusline:' });
  });
});
