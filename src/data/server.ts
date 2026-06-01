import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';

export interface Conn {
  client: ReturnType<typeof createOpencodeClient>;
  serverUrl: string;
  close(): void;
}

/**
 * Connect to OpenCode. If `serverUrl` is given, attach to that running server.
 * Otherwise spawn and manage our own `opencode serve` via createOpencode().
 */
export async function connect(serverUrl?: string): Promise<Conn> {
  if (serverUrl) {
    const client = createOpencodeClient({ baseUrl: serverUrl } as any);
    return { client, serverUrl, close() {} };
  }
  const { client, server } = await createOpencode();
  return { client, serverUrl: server.url, close: () => server.close() };
}

/**
 * Subscribe to the OpenCode event stream and invoke onEvent for each event.
 * Returns a stop() function.
 *
 * SDK shape (verified against @opencode-ai/sdk dist/gen/sdk.gen.d.ts):
 *   client.event.subscribe() returns Promise<ServerSentEventsResult<...>>
 *   ServerSentEventsResult = { stream: AsyncGenerator<...> }
 */
export async function subscribeEvents(
  client: ReturnType<typeof createOpencodeClient>,
  onEvent: (event: any) => void,
): Promise<() => void> {
  const result: any = await (client as any).event.subscribe();
  let stopped = false;
  // ServerSentEventsResult: { stream: AsyncGenerator<TData[keyof TData]> }
  const stream = result.stream ?? result;
  (async () => {
    try {
      for await (const ev of stream) {
        if (stopped) break;
        onEvent(ev);
      }
    } catch {
      /* stream ended/aborted */
    }
  })();
  return () => { stopped = true; };
}
