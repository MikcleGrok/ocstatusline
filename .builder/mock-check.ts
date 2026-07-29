#!/usr/bin/env bun
// mock-check.ts — prove the SDK talks to mock-opencode in dev mode

const SERVER = process.env.OCSL_SERVER ?? 'http://mock-opencode:4096';

console.log(`>> bun run src/index.ts start --server ${SERVER} (6s)`);

const proc = Bun.spawnSync(['bun', 'run', 'src/index.ts', 'start', '--server', SERVER], {
  stdout: 'pipe',
  stderr: 'pipe',
  timeout: 6000,
});

const stdout = new TextDecoder().decode(proc.stdout);
const stderr = new TextDecoder().decode(proc.stderr);

console.log(`   daemon rc=${proc.exitCode}`);
console.log('--- stdout ---');
console.log(stdout);
console.log('--- stderr ---');
console.log(stderr);

if (!stdout.includes('qwen3-coder')) {
  console.log('FAIL: no rendered status line — the SDK never received the mock\'s events');
  process.exit(1);
}
console.log('OK: mock-check passed');