import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { eventsToJsonl } from '../../scripts/record-fixtures';
import { readFixture } from '../helpers/fixtures';

describe('eventsToJsonl', () => {
  it('writes one compact JSON object per line, newline-terminated', () => {
    const jsonl = eventsToJsonl([{ type: 'a' }, { type: 'b', properties: { n: 1 } }]);
    expect(jsonl).toBe('{"type":"a"}\n{"type":"b","properties":{"n":1}}\n');
  });

  it('produces an empty string for no events', () => {
    expect(eventsToJsonl([])).toBe('');
  });

  it('round-trips through readFixture', () => {
    const events = [
      { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } },
      { type: 'session.idle', properties: {} },
    ];
    const dir = mkdtempSync(path.join(tmpdir(), 'ocsl-fixture-'));
    const file = path.join(dir, 'recorded.jsonl');
    writeFileSync(file, eventsToJsonl(events), 'utf-8');
    expect(readFixture(file)).toEqual(events);
  });
});