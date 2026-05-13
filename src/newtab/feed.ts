import type { Bookmark } from '../shared/types';

const DAY_MS = 86_400_000;

export function weightFor(bookmark: Bookmark, now: number): number {
  if (bookmark.removed) return 0;

  const base = 1 / Math.sqrt(bookmark.shownCount + 1);
  const ageDays = Math.max(0, (now - bookmark.capturedAt) / DAY_MS);
  const recency = 1 + Math.max(0, 1 - ageDays / 30);
  const consumedPenalty = bookmark.consumedAt ? 0 : 1;

  return base * recency * consumedPenalty;
}

export function pickNext(items: Bookmark[], now: number): Bookmark | null {
  if (items.length === 0) return null;

  const weights = items.map((bookmark) => weightFor(bookmark, now));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return null;

  let remaining = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    remaining -= weights[i]!;
    if (remaining <= 0) return items[i]!;
  }

  return items[items.length - 1]!;
}

export function pickN(
  items: Bookmark[],
  now: number,
  count: number,
  exclude: Set<string>,
): Bookmark[] {
  const out: Bookmark[] = [];
  const pool = items.filter((bookmark) => !exclude.has(bookmark.urlHash));

  for (let i = 0; i < count; i += 1) {
    const picked = pickNext(pool, now);
    if (!picked) break;

    out.push(picked);
    exclude.add(picked.urlHash);

    const index = pool.indexOf(picked);
    if (index >= 0) pool.splice(index, 1);
  }

  return out;
}
