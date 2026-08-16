#!/usr/bin/env bun
import { strict as assert } from 'node:assert';
import { VERSION } from '../../src/version.js';
import { runCli } from '../support/act.js';

async function main(): Promise<void> {
  const help = await runCli(['--help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /Usage: ocstatusline/);

  const version = await runCli(['--version']);
  assert.equal(version.exitCode, 0);
  assert.equal(version.stdout, `${VERSION}\n`);

  const rendered = await runCli(['render', '--stdin'], JSON.stringify({ version: 1, model: 'cli-model', termWidth: 120 }));
  assert.equal(rendered.exitCode, 0);
  assert.match(rendered.stdout, /cli-model/);
  assert.equal(rendered.stdout.endsWith('\n'), true);
  assert.equal(/\x1b\[/.test(rendered.stdout), false);

  const malformedInvocation = await runCli(['render']);
  assert.equal(malformedInvocation.exitCode, 1);
  assert.match(malformedInvocation.stderr, /render requires exactly --stdin/);

  const malformedJson = await runCli(['render', '--stdin'], '{bad json');
  assert.equal(malformedJson.exitCode, 1);
  assert.match(malformedJson.stderr, /ocstatusline:/);

  // No real secretd guaranteed in this environment: openrouter-status must
  // still exit 0 with a well-formed JSON line, failing closed to nulls --
  // never erroring just because the daemon is unreachable.
  const openrouterStatus = await runCli(['openrouter-status', '--timeout', '200']);
  assert.equal(openrouterStatus.exitCode, 0);
  const parsed = JSON.parse(openrouterStatus.stdout);
  assert.ok('balance' in parsed && 'usage' in parsed);
  console.log('CLI acceptance: 6 scenarios passed');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
