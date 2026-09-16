import { existsSync, writeFileSync } from 'node:fs';
import { updateWeeklyState } from '../../src/data/openrouter-weekly';

const [statePath, barrierPath, workerId, nowText, usageAtStartText, observedUsageText] = process.argv.slice(2);

if (!statePath || !barrierPath || !workerId || !nowText || !usageAtStartText || !observedUsageText) {
  throw new Error('usage: worker <statePath> <barrierPath> <workerId> <now> <usageAtStart> <observedUsage>');
}

writeFileSync(`${barrierPath}.ready-${workerId}`, String(process.pid), 'utf8');
if (workerId === 'live') {
  const releaseDeadline = Date.now() + 45_000;
  while (!existsSync(`${barrierPath}.release-live`) && Date.now() < releaseDeadline) await new Promise((resolve) => setImmediate(resolve));
  if (!existsSync(`${barrierPath}.release-live`)) throw new Error('live-owner release timeout');
  process.exit(0);
}
const deadline = Date.now() + 5_000;
while (!existsSync(barrierPath) && !existsSync(`${barrierPath}.go-${workerId}`) && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
if (!existsSync(barrierPath) && !existsSync(`${barrierPath}.go-${workerId}`)) throw new Error('barrier timeout');

updateWeeklyState(null, Number(usageAtStartText), 25, Number(nowText), null, statePath);
if (Number(observedUsageText) !== Number(usageAtStartText)) updateWeeklyState(null, Number(observedUsageText), 25, Number(nowText), null, statePath);
