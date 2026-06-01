import { WIDGETS } from '../widgets/index.js';

export interface CatalogEntry { type: string; label: string; }

export function availableWidgets(): CatalogEntry[] {
  return Object.values(WIDGETS)
    .filter((w) => w.type !== 'separator')
    .map((w) => ({ type: w.type, label: w.label }));
}
