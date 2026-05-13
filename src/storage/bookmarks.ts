import type { Bookmark, BookmarkSource } from '../shared/types';
import { deriveAutoTags, mergeTags } from '../shared/auto-tags';
import { hashUrl, normalizeUrl } from '../shared/url';
import { requestToPromise, withBookmarksStore } from './db';

export interface UpsertInput {
  url: string;
  title?: string;
  source: BookmarkSource;
  capturedAt?: number;
  tags?: string[];
  touchExisting?: boolean;
  chromeId?: string;
  readingListAt?: number | null;
  destination?: 'reading' | 'bookmarks';
}

export async function upsertByHash(input: UpsertInput): Promise<Bookmark> {
  const url = normalizeUrl(input.url);
  const urlHash = await hashUrl(url);
  const now = input.capturedAt ?? Date.now();

  return withBookmarksStore('readwrite', async (store) => {
    const existing = await requestToPromise<Bookmark | undefined>(
      store.index('urlHash').get(urlHash),
    );

    const autoAddSources: BookmarkSource[] = ['manual', 'shortcut', 'context-menu', 'pocket-import'];
    const isSiteSource = input.source.startsWith('site:');

    if (existing) {
      const row: Bookmark =
        input.touchExisting === false
          ? { ...existing, removed: false }
          : {
              ...existing,
              capturedAt: now,
              shownCount: 0,
              removed: false,
            };
      if (input.title && (!existing.title || existing.title === existing.url)) row.title = input.title;
      row.tags = mergeTags(existing.tags, [...(input.tags ?? []), ...deriveAutoTags(url)]);
      if (input.chromeId !== undefined) row.chromeId = input.chromeId;
      if (input.destination === 'reading') {
        row.readingListAt = now;
      } else if (input.destination === 'bookmarks') {
        row.readingListAt = undefined;
      } else if (input.readingListAt === null) {
        row.readingListAt = undefined;
      } else if (input.readingListAt !== undefined) {
        row.readingListAt = input.readingListAt;
      } else if (
        row.readingListAt === undefined &&
        (autoAddSources.includes(input.source) || isSiteSource)
      ) {
        row.readingListAt = now;
      }
      await requestToPromise(store.put(row));
      return row;
    }

    let readingListAt: number | undefined;
    if (input.destination === 'reading') {
      readingListAt = now;
    } else if (input.destination === 'bookmarks') {
      readingListAt = undefined;
    } else if (input.readingListAt === null) {
      readingListAt = undefined;
    } else if (input.readingListAt !== undefined) {
      readingListAt = input.readingListAt;
    } else if (autoAddSources.includes(input.source) || isSiteSource) {
      readingListAt = now;
    }

    const row: Bookmark = {
      url,
      urlHash,
      title: input.title ?? url,
      source: input.source,
      capturedAt: now,
      shownCount: 0,
      tags: mergeTags(input.tags, deriveAutoTags(url)),
      enrichment: 'pending',
      enrichmentAttempts: 0,
      chromeId: input.chromeId,
      readingListAt,
    };
    const id = await requestToPromise<IDBValidKey>(store.add(row));
    if (typeof id !== 'number') throw new Error('IndexedDB returned a non-numeric bookmark id');
    return { ...row, id };
  });
}

export function getById(id: number): Promise<Bookmark | undefined> {
  return withBookmarksStore('readonly', (store) =>
    requestToPromise<Bookmark | undefined>(store.get(id)),
  );
}

export function listForFeed(opts: {
  limit: number;
  sessionExclude?: Set<string>;
}): Promise<Bookmark[]> {
  const { limit, sessionExclude } = opts;
  return withBookmarksStore('readonly', async (store) => {
    const rows = await requestToPromise<Bookmark[]>(store.getAll());
    return rows
      .filter((bookmark) => bookmark.removed !== true && !sessionExclude?.has(bookmark.urlHash))
      .sort((a, b) => b.capturedAt - a.capturedAt)
      .slice(0, limit * 4);
  });
}

export async function markConsumed(id: number): Promise<void> {
  await patch(id, { consumedAt: Date.now() });
}

export async function incrementShown(id: number): Promise<void> {
  await withBookmarksStore('readwrite', async (store) => {
    const row = await requestToPromise<Bookmark | undefined>(store.get(id));
    if (!row) return;

    await requestToPromise(
      store.put({
        ...row,
        shownCount: row.shownCount + 1,
        lastShownAt: Date.now(),
      }),
    );
  });
}

export async function markRemoved(urlHash: string): Promise<void> {
  await withBookmarksStore('readwrite', async (store) => {
    const row = await requestToPromise<Bookmark | undefined>(store.index('urlHash').get(urlHash));
    if (!row) return;
    await requestToPromise(store.put({ ...row, removed: true }));
  });
}

export async function clearAll(): Promise<void> {
  await withBookmarksStore('readwrite', async (store) => {
    await requestToPromise(store.clear());
  });
}

export function backfillAutoTags(): Promise<{ updated: number }> {
  return withBookmarksStore('readwrite', async (store) => {
    const rows = await requestToPromise<Bookmark[]>(store.getAll());
    let updated = 0;

    for (const row of rows) {
      const tags = mergeTags(row.tags, deriveAutoTags(row.url));
      if (sameTags(row.tags, tags)) continue;
      await requestToPromise(store.put({ ...row, tags }));
      updated += 1;
    }

    return { updated };
  });
}

function sameTags(left: string[] | undefined, right: string[]): boolean {
  return (left ?? []).join('\0') === right.join('\0');
}

export function listPendingEnrichment(limit: number): Promise<Bookmark[]> {
  return withBookmarksStore('readonly', async (store) => {
    const rows = await requestToPromise<Bookmark[]>(
      store.index('enrichment').getAll('pending', limit),
    );
    return rows;
  });
}

export function countByEnrichment(status: 'pending' | 'ok' | 'failed'): Promise<number> {
  return withBookmarksStore('readonly', (store) =>
    requestToPromise<number>(store.index('enrichment').count(status)),
  );
}

export function listFailedEnrichment(): Promise<Bookmark[]> {
  return withBookmarksStore('readonly', (store) =>
    requestToPromise<Bookmark[]>(store.index('enrichment').getAll('failed')),
  );
}

export async function patch(id: number, fields: Partial<Bookmark>): Promise<void> {
  await withBookmarksStore('readwrite', async (store) => {
    const row = await requestToPromise<Bookmark | undefined>(store.get(id));
    if (!row) return;
    await requestToPromise(store.put({ ...row, ...fields }));
  });
}

export function findByChromeId(chromeId: string): Promise<Bookmark | undefined> {
  return withBookmarksStore('readonly', (store) =>
    requestToPromise<Bookmark | undefined>(store.index('chromeId').get(chromeId)),
  );
}

export async function hardDelete(id: number): Promise<void> {
  await withBookmarksStore('readwrite', async (store) => {
    await requestToPromise(store.delete(id));
  });
}

export async function markReadingList(id: number): Promise<void> {
  await patch(id, { readingListAt: Date.now() });
}

export async function unmarkReadingList(id: number): Promise<void> {
  await patch(id, { readingListAt: undefined });
}
