export const MAX_MESSAGE_ENTRIES = 1_000;

export function retainLatestEntries<T>(entries: Record<string, T>, maxEntries: number, protectedKey?: string): Record<string, T> {
  while (Object.keys(entries).length > maxEntries) {
    const oldestKey = Object.keys(entries).find((key) => key !== protectedKey);
    if (oldestKey === undefined) break;
    delete entries[oldestKey];
  }
  return entries;
}
