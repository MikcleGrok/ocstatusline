import { createOpencodeClient } from '@opencode-ai/sdk';

const baseUrl = process.env.OCSL_SERVER ?? 'http://mock-opencode:4096';
console.log(`baseUrl: ${baseUrl}`);

const raw = await fetch(`${baseUrl}/event`, { headers: { accept: 'text/event-stream' } });
console.log(`raw GET /event: status=${raw.status} content-type=${raw.headers.get('content-type')}`);

const client = createOpencodeClient({ baseUrl } as never);
const result: any = await (client as any).event.subscribe();
console.log(`subscribe() returned keys: ${JSON.stringify(Object.keys(result ?? {}))}`);

const stream = result?.stream ?? result;
let seen = 0;

for await (const event of stream) {
  console.log(`event ${++seen}: ${JSON.stringify(event)}`);
  if (seen >= 2) break;
}
console.log(seen === 0 ? 'FAIL: the stream yielded nothing' : `OK: the SDK yielded ${seen} events`);
process.exit(seen === 0 ? 1 : 0);