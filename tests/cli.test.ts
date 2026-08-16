import { describe, it, expect } from 'vitest';
import { parseCli } from '../src/cli';

describe('parseCli', () => {
  it('no args → tui mode', () => {
    expect(parseCli([])).toEqual({ mode: 'tui' });
  });
  it('unknown subcommand → tui mode', () => {
    expect(parseCli(['wat'])).toEqual({ mode: 'tui' });
  });
  it('start → daemon mode, no server', () => {
    expect(parseCli(['start'])).toEqual({ mode: 'daemon', serverUrl: undefined });
  });
  it('start --server <url> → daemon mode with url', () => {
    expect(parseCli(['start', '--server', 'http://127.0.0.1:4096']))
      .toEqual({ mode: 'daemon', serverUrl: 'http://127.0.0.1:4096' });
  });
  it('render --stdin → one-shot render mode', () => {
    expect(parseCli(['render', '--stdin'])).toEqual({ mode: 'stdin-render' });
  });
  it('rejects extra render --stdin arguments', () => {
    expect(parseCli(['render', '--stdin', 'extra'])).toEqual({ mode: 'error', error: 'render --stdin does not accept additional arguments' });
  });
  it('rejects render without --stdin', () => {
    expect(parseCli(['render'])).toEqual({ mode: 'error', error: 'render requires exactly --stdin' });
  });
  it('rejects render --help as a malformed render invocation', () => {
    expect(parseCli(['render', '--help'])).toEqual({ mode: 'error', error: 'render requires exactly --stdin' });
  });
  it('rejects render --stdin=value', () => {
    expect(parseCli(['render', '--stdin=snapshot.json'])).toEqual({ mode: 'error', error: 'render requires exactly --stdin' });
  });
  it('install → install mode', () => {
    expect(parseCli(['install'])).toEqual({ mode: 'install' });
  });
  it('openrouter-status → openrouter-status mode, no timeout', () => {
    expect(parseCli(['openrouter-status'])).toEqual({ mode: 'openrouter-status' });
  });
  it('openrouter-status --timeout <ms> → openrouter-status mode with timeout', () => {
    expect(parseCli(['openrouter-status', '--timeout', '500'])).toEqual({ mode: 'openrouter-status', timeoutMs: 500 });
  });
  it('rejects openrouter-status with an unrelated extra argument', () => {
    expect(parseCli(['openrouter-status', 'extra'])).toEqual({ mode: 'error', error: 'openrouter-status accepts only --timeout MS' });
  });
  it('rejects openrouter-status --timeout without a value', () => {
    expect(parseCli(['openrouter-status', '--timeout'])).toEqual({ mode: 'error', error: 'openrouter-status accepts only --timeout MS' });
  });
  it('rejects openrouter-status --timeout with trailing extra arguments', () => {
    expect(parseCli(['openrouter-status', '--timeout', '500', 'extra'])).toEqual({ mode: 'error', error: 'openrouter-status accepts only --timeout MS' });
  });
  it('--help → help mode', () => {
    expect(parseCli(['--help'])).toEqual({ mode: 'help' });
  });
  it('-h → help mode', () => {
    expect(parseCli(['-h'])).toEqual({ mode: 'help' });
  });
  it('help → help mode', () => {
    expect(parseCli(['help'])).toEqual({ mode: 'help' });
  });
  it('--version → version mode', () => {
    expect(parseCli(['--version'])).toEqual({ mode: 'version' });
  });
  it('-v → version mode', () => {
    expect(parseCli(['-v'])).toEqual({ mode: 'version' });
  });
});
