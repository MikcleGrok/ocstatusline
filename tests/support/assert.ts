import { expect } from 'vitest';
import type { ProcessResult } from './act.js';

export function expectCli(result: ProcessResult, expected: { exitCode: number; stdout?: string; stderr?: string }): void {
  expect(result.exitCode).toBe(expected.exitCode);
  if (expected.stdout !== undefined) expect(result.stdout).toContain(expected.stdout);
  if (expected.stderr !== undefined) expect(result.stderr).toContain(expected.stderr);
}
