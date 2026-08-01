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
  it('--help → help mode', () => {
    expect(parseCli(['--help'])).toEqual({ mode: 'help' });
  });
  it('-h → help mode', () => {
    expect(parseCli(['-h'])).toEqual({ mode: 'help' });
  });
  it('help → help mode', () => {
    expect(parseCli(['help'])).toEqual({ mode: 'help' });
  });
});
