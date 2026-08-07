import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function uniqueMarker(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function uniqueTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-${uniqueMarker('run')}-`));
}
