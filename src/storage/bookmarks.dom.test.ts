import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backfillAutoTags,
  clearAll,
  findByChromeId,
  getById,
  incrementShown,
  listFailedEnrichment,
  listForFeed,
  listPendingEnrichment,
  markConsumed,
  markReadingList,
  markRemoved,
  patch,
  unmarkReadingList,
  upsertByHash,
} from './bookmarks';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('delete database blocked'));
  });
}

describe('bookmarks storage', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await deleteDatabase('attic');
  });

  it('upserts by normalized URL hash and merges incoming tags', async () => {
    const first = await upsertByHash({
      url: 'https://example.com/path#section',
      title: 'First title',
      source: 'manual',
      capturedAt: 100,
      tags: ['research'],
    });
    const second = await upsertByHash({
      url: 'https://example.com/path',
      title: 'Second title',
      source: 'site:youtube',
      capturedAt: 200,
      tags: ['video', 'research'],
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('First title');
    expect(second.capturedAt).toBe(200);
    expect(second.shownCount).toBe(0);
    expect(second.removed).toBe(false);
    expect(second.tags).toEqual(['example', 'research', 'video']);
  });

  it('adds inferred website tags and backfills old saved rows', async () => {
    const github = await upsertByHash({
      url: 'https://github.com/HeyPuter/puter',
      title: 'Puter',
      source: 'chrome-bookmarks',
      tags: ['open-source'],
    });
    expect(github.tags).toEqual(['code', 'github', 'open-source']);

    await patch(github.id!, { tags: ['open-source'] });
    const result = await backfillAutoTags();
    expect(result).toEqual({ updated: 1 });

    const [backfilled] = await listForFeed({ limit: 10 });
    expect(backfilled?.tags).toEqual(['code', 'github', 'open-source']);
  });

  it('preserves cached metadata and feed history during routine sync', async () => {
    const row = await upsertByHash({
      url: 'https://example.com/cache',
      title: 'Original',
      source: 'chrome-bookmarks',
      capturedAt: 100,
      tags: ['manual-tag'],
    });
    await patch(row.id!, {
      description: 'Cached description',
      imageUrl: 'https://example.com/image.png',
      enrichment: 'ok',
      enrichmentAttempts: 1,
      shownCount: 4,
      lastShownAt: 500,
    });

    const synced = await upsertByHash({
      url: 'https://example.com/cache',
      title: 'Synced title',
      source: 'chrome-bookmarks',
      capturedAt: 900,
      tags: ['synced-tag'],
      touchExisting: false,
    });

    expect(synced).toMatchObject({
      id: row.id,
      title: 'Original',
      capturedAt: 100,
      description: 'Cached description',
      imageUrl: 'https://example.com/image.png',
      enrichment: 'ok',
      enrichmentAttempts: 1,
      shownCount: 4,
      lastShownAt: 500,
      tags: ['example', 'manual-tag', 'synced-tag'],
    });
  });

  it('lists only active feed rows in newest-first order', async () => {
    const old = await upsertByHash({
      url: 'https://old.example',
      title: 'Old',
      source: 'manual',
      capturedAt: 100,
    });
    const fresh = await upsertByHash({
      url: 'https://fresh.example',
      title: 'Fresh',
      source: 'manual',
      capturedAt: 300,
    });
    const removed = await upsertByHash({
      url: 'https://removed.example',
      title: 'Removed',
      source: 'manual',
      capturedAt: 400,
    });
    await markRemoved(removed.urlHash);

    const rows = await listForFeed({ limit: 10, sessionExclude: new Set([old.urlHash]) });

    expect(rows.map((row) => row.id)).toEqual([fresh.id]);
  });

  it('uses URL as a fallback title and ignores missing removals', async () => {
    const row = await upsertByHash({
      url: 'https://fallback.example',
      source: 'manual',
      tags: ['first'],
    });
    await upsertByHash({
      url: 'https://fallback.example',
      title: 'Filled later',
      source: 'manual',
    });
    await markRemoved('missing-hash');

    const updated = await getById(row.id!);
    expect(updated?.title).toBe('Filled later');
    expect(updated?.tags).toEqual(['fallback', 'first']);
  });

  it('patches rows, marks consumed, increments shown, and ignores missing ids', async () => {
    vi.setSystemTime(1_000);
    const row = await upsertByHash({
      url: 'https://example.com',
      title: 'Example',
      source: 'manual',
      capturedAt: 100,
    });

    await patch(row.id!, { description: 'Saved for later' });
    await markConsumed(row.id!);
    vi.setSystemTime(2_000);
    await incrementShown(row.id!);
    await patch(999, { title: 'missing' });
    await incrementShown(999);

    const updated = await getById(row.id!);
    expect(updated).toMatchObject({
      description: 'Saved for later',
      consumedAt: 1_000,
      shownCount: 1,
      lastShownAt: 2_000,
    });
  });

  it('looks up a bookmark by its Chrome id', async () => {
    await upsertByHash({
      url: 'https://by-id.example',
      source: 'chrome-bookmarks',
      chromeId: 'chrome-42',
    });
    const found = await findByChromeId('chrome-42');
    expect(found?.url).toBe('https://by-id.example/');
    expect(found?.chromeId).toBe('chrome-42');
    expect(await findByChromeId('missing')).toBeUndefined();
  });

  it('lists pending and failed enrichment rows and clears all data', async () => {
    const pending = await upsertByHash({
      url: 'https://pending.example',
      title: 'Pending',
      source: 'manual',
    });
    const failed = await upsertByHash({
      url: 'https://failed.example',
      title: 'Failed',
      source: 'manual',
    });
    await patch(failed.id!, { enrichment: 'failed' });

    expect((await listPendingEnrichment(5)).map((row) => row.id)).toEqual([pending.id]);
    expect((await listFailedEnrichment()).map((row) => row.id)).toEqual([failed.id]);

    await clearAll();
    expect(await listForFeed({ limit: 10 })).toEqual([]);
  });

  it('preserves readingListAt when re-upserting a source that already has it, and allows explicit null removal', async () => {
    // First insert with manual source → auto-adds to reading list
    const first = await upsertByHash({
      url: 'https://rl-test.example',
      source: 'manual',
    });
    expect(first.readingListAt).toBeGreaterThan(0);

    // Re-upsert with explicit readingListAt value — should overwrite
    const updated = await upsertByHash({
      url: 'https://rl-test.example',
      source: 'manual',
      readingListAt: 9999,
    });
    expect(updated.readingListAt).toBe(9999);

    // Re-upsert with null — should remove from reading list
    const removed = await upsertByHash({
      url: 'https://rl-test.example',
      source: 'manual',
      readingListAt: null,
    });
    expect(removed.readingListAt).toBeUndefined();
  });

  it('auto-adds Attic captures to the reading list and skips chrome-bookmarks', async () => {
    const captured = await upsertByHash({
      url: 'https://from-shortcut.example',
      source: 'shortcut',
    });
    const chromeBookmarked = await upsertByHash({
      url: 'https://from-chrome.example',
      source: 'chrome-bookmarks',
    });
    expect(captured.readingListAt).toBeGreaterThan(0);
    expect(chromeBookmarked.readingListAt).toBeUndefined();
  });

  it('skips reading-list auto-add when readingListAt is explicitly null (ask-mode capture)', async () => {
    const askedShortcut = await upsertByHash({
      url: 'https://ask-shortcut.example',
      source: 'shortcut',
      readingListAt: null,
    });
    const askedContextMenu = await upsertByHash({
      url: 'https://ask-context.example',
      source: 'context-menu',
      readingListAt: null,
    });
    expect(askedShortcut.readingListAt).toBeUndefined();
    expect(askedContextMenu.readingListAt).toBeUndefined();
  });

  it('clears existing readingListAt when destination is explicitly bookmarks', async () => {
    // First save lands the row on the reading list (legacy auto-add for manual source)
    const first = await upsertByHash({
      url: 'https://dest-override.example',
      source: 'manual',
    });
    expect(first.readingListAt).toBeGreaterThan(0);

    // Re-save the same URL with destination: 'bookmarks' — should clear readingListAt
    const second = await upsertByHash({
      url: 'https://dest-override.example',
      source: 'manual',
      destination: 'bookmarks',
    });
    expect(second.id).toBe(first.id);
    expect(second.readingListAt).toBeUndefined();
  });

  it('honors explicit destination on upsert', async () => {
    const reading = await upsertByHash({
      url: 'https://reading.example',
      source: 'manual',
      destination: 'reading',
    });
    expect(reading.readingListAt).toBeGreaterThan(0);

    const bookmarksOnly = await upsertByHash({
      url: 'https://bookmark.example',
      source: 'manual',
      destination: 'bookmarks',
    });
    expect(bookmarksOnly.readingListAt).toBeUndefined();
  });

  it('toggles reading list membership via markReadingList/unmarkReadingList without touching consumedAt', async () => {
    const row = await upsertByHash({
      url: 'https://toggle.example',
      source: 'chrome-bookmarks',
    });
    await patch(row.id!, { consumedAt: 12345 });

    await markReadingList(row.id!);
    const after = await getById(row.id!);
    expect(after?.readingListAt).toBeGreaterThan(0);
    // Star is independent of done — adding to the reading list does not undo a previous done.
    expect(after?.consumedAt).toBe(12345);

    await unmarkReadingList(row.id!);
    const cleared = await getById(row.id!);
    expect(cleared?.readingListAt).toBeUndefined();
    expect(cleared?.consumedAt).toBe(12345);
  });
});
