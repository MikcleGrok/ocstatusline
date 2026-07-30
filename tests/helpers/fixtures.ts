import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'events');

export function readFixture(file: string): unknown[] {
  const full = path.isAbsolute(file) ? file : path.join(FIXTURE_DIR, path.basename(file));
  return readFileSync(full, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as unknown);
}