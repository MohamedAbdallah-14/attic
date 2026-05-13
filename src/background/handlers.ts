import type { Bookmark, CapturePayload } from '../shared/types';
import { isHttpUrl } from '../shared/url';
import {
  backfillAutoTags,
  clearAll,
  countByEnrichment,
  getById,
  hardDelete,
  listFailedEnrichment,
  markReadingList,
  patch,
  unmarkReadingList,
  upsertByHash,
} from '../storage/bookmarks';
import { requestToPromise, withBookmarksStore, withImagesStore } from '../storage/db';
import type { CachedImage } from '../storage/images';
import { initialSync, routineSync } from './bookmarks-sync';
import { kickBurstEnrichment, kickEnrichment } from './enrichment';
import {
  createFolder,
  findFolderByName,
  listAllFolders,
  moveBookmarkToFolder,
  removeChromeBookmark,
} from './folders';
import { on } from './messaging';
import { claimSync, finishSync, releaseSync } from './sync-state';

async function readCaptureMode(): Promise<'ask' | 'reading' | 'bookmarks'> {
  const result = await chrome.storage.local.get('atticCaptureMode');
  const value = result.atticCaptureMode;
  return value === 'reading' || value === 'bookmarks' ? value : 'ask';
}

async function promptDestination(bookmarkId: number, title: string): Promise<void> {
  const notifId = `attic-capture-${bookmarkId}`;
  try {
    await chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
      title: 'Saved to Attic',
      message: title.slice(0, 80),
      buttons: [{ title: 'Reading list' }, { title: 'Bookmarks' }],
      priority: 1,
      requireInteraction: false,
    });
  } catch (error) {
    // Ask-mode rows save with readingListAt unset. If the notification fails
    // (permission revoked, OS-level Do Not Disturb, etc.), the user has no UI
    // to pick a destination — the row would silently sit in Bookmarks.
    // Default to Reading list so the row lands somewhere predictable; matches
    // the popup's default capture destination.
    console.warn('[attic] notification failed; defaulting to Reading list', error);
    try {
      await patch(bookmarkId, { readingListAt: Date.now() });
    } catch (patchError) {
      console.warn('[attic] readingListAt fallback patch also failed', patchError);
    }
  }
}

async function capture(payload: CapturePayload) {
  if (!isHttpUrl(payload.url)) {
    return { skipped: true, reason: 'non-http url' };
  }

  const row = await upsertByHash({
    url: payload.url,
    title: payload.title,
    source: payload.source,
    tags: payload.tags,
    destination: payload.destination,
    readingListAt: payload.readingListAt,
  });

  void kickEnrichment();

  return { id: row.id };
}

export async function maybeSyncBookmarks(): Promise<{
  synced: boolean;
  inserted: number;
  tagged: number;
}> {
  const claimed = await claimSync();
  if (!claimed) return { synced: false, inserted: 0, tagged: 0 };

  try {
    const sync = await routineSync();
    const tags = await backfillAutoTags();
    await kickEnrichment();
    await finishSync();
    return { synced: true, inserted: sync.inserted, tagged: tags.updated };
  } catch (error) {
    await releaseSync();
    throw error;
  }
}

export function registerHandlers(): void {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-current-page') return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const mode = await readCaptureMode();
    const destination = mode === 'ask' ? undefined : mode;
    const readingListAt = mode === 'ask' ? null : undefined;
    const row = await capture({
      url: tab.url,
      title: tab.title,
      source: 'shortcut',
      destination,
      readingListAt,
    });
    if (mode === 'ask' && row && 'id' in row && row.id != null) {
      void promptDestination(row.id, tab.title ?? tab.url);
    }
  });

  chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
    if (!notifId.startsWith('attic-capture-')) return;
    const idStr = notifId.replace('attic-capture-', '');
    const bookmarkId = Number(idStr);
    if (!Number.isFinite(bookmarkId)) return;

    if (buttonIndex === 0) {
      await patch(bookmarkId, { readingListAt: Date.now() });
    } else if (buttonIndex === 1) {
      await patch(bookmarkId, { readingListAt: undefined });
    }
    await chrome.notifications.clear(notifId);
  });

  on('capture', async (msg) => capture(msg.payload));
  on('maybe-sync-bookmarks', async () => maybeSyncBookmarks());

  on('rerun-failed-enrichment', async () => {
    const failed = await listFailedEnrichment();
    for (const row of failed) {
      if (row.id != null) {
        await patch(row.id, { enrichment: 'pending', enrichmentAttempts: 0 });
      }
    }
    void kickEnrichment();
    return { reset: failed.length };
  });

  on('resync-bookmarks', async () => {
    const result = await initialSync();
    void kickBurstEnrichment();
    return result;
  });

  on('clear-all', async () => {
    await clearAll();
    await withImagesStore('readwrite', async (store) => {
      await requestToPromise(store.clear());
    });
    return { ok: true };
  });

  on('import-pocket', async (msg) => {
    let inserted = 0;
    for (const row of msg.payload.rows) {
      await upsertByHash({
        url: row.url,
        title: row.title,
        source: 'pocket-import',
        capturedAt: row.capturedAt,
        tags: row.tags,
      });
      inserted += 1;
    }
    void kickBurstEnrichment();
    return { inserted };
  });

  on('enrichment-status', async () => {
    const [pending, ok, failed] = await Promise.all([
      countByEnrichment('pending'),
      countByEnrichment('ok'),
      countByEnrichment('failed'),
    ]);
    return { pending, ok, failed };
  });

  on('kick-burst-enrichment', async () => {
    return kickBurstEnrichment();
  });

  on('list-folders', async () => {
    const folders = await listAllFolders();
    return folders.map(({ id, title, path }) => ({ id, title, path }));
  });

  on('update-tags', async (msg) => {
    await patch(msg.payload.bookmarkId, { tags: msg.payload.tags });

    const row = await getById(msg.payload.bookmarkId);
    if (!row?.chromeId) return { moved: false };

    for (const tag of msg.payload.tags) {
      const folder = await findFolderByName(tag);
      if (folder) {
        await moveBookmarkToFolder(row.chromeId, folder.id);
        return { moved: true, folderTitle: folder.title };
      }
    }
    return { moved: false };
  });

  on('apply-folder-tag', async (msg) => {
    const row = await getById(msg.payload.bookmarkId);
    if (!row?.chromeId) return { moved: false };
    await moveBookmarkToFolder(row.chromeId, msg.payload.folderId);
    return { moved: true };
  });

  on('create-folder-and-move', async (msg) => {
    const row = await getById(msg.payload.bookmarkId);
    if (!row?.chromeId) return { moved: false };
    const folder = await createFolder(msg.payload.title, msg.payload.parentId);
    await moveBookmarkToFolder(row.chromeId, folder.id);
    return { moved: true, folderId: folder.id };
  });

  on('toggle-reading-list', async (msg) => {
    if (msg.payload.add) await markReadingList(msg.payload.bookmarkId);
    else await unmarkReadingList(msg.payload.bookmarkId);
    return { ok: true };
  });

  on('delete-bookmark', async (msg) => {
    const row = await getById(msg.payload.bookmarkId);
    if (!row) return { ok: false, reason: 'not found' };

    if (msg.payload.scope === 'both' && row.chromeId) {
      try {
        await removeChromeBookmark(row.chromeId);
      } catch (error) {
        console.warn('[attic] chrome delete failed', error);
      }
    }
    await hardDelete(msg.payload.bookmarkId);
    return { ok: true };
  });

  on('popup-stats', async () => {
    const rows = await withBookmarksStore('readonly', async (store) =>
      requestToPromise<Bookmark[]>(store.getAll()),
    );
    const active = rows.filter((row) => row.removed !== true);
    return {
      bookmarks: active.length,
      reading: active.filter((row) => row.readingListAt && !row.consumedAt).length,
      done: active.filter((row) => row.consumedAt).length,
    };
  });

  on('image-cache-stats', async () => {
    const rows = await withImagesStore('readonly', (store) =>
      requestToPromise<CachedImage[]>(store.getAll()),
    );
    return { count: rows.length, bytes: rows.reduce((acc, r) => acc + r.byteSize, 0) };
  });

  on('local-activity', async () => {
    const rows = await withBookmarksStore('readonly', (store) =>
      requestToPromise<Bookmark[]>(store.getAll()),
    );
    const sevenAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      capturesWeek: rows.filter((r) => r.capturedAt >= sevenAgo).length,
      doneWeek: rows.filter((r) => r.consumedAt != null && r.consumedAt >= sevenAgo).length,
      shownTotal: rows.reduce((acc, r) => acc + (r.shownCount ?? 0), 0),
    };
  });

  on('export-data', async () => {
    const rows = await withBookmarksStore('readonly', (store) =>
      requestToPromise<Bookmark[]>(store.getAll()),
    );
    return { bookmarks: rows, exportedAt: Date.now() };
  });
}

export function registerContextMenus(): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'br-save-page',
      title: 'Save page to feed',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'br-save-link',
      title: 'Save link to feed',
      contexts: ['link'],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'br-save-page') {
      if (!tab?.url) return;
      const mode = await readCaptureMode();
      const destination = mode === 'ask' ? undefined : mode;
      const readingListAt = mode === 'ask' ? null : undefined;
      const row = await capture({
        url: tab.url,
        title: tab.title,
        source: 'context-menu',
        destination,
        readingListAt,
      });
      if (mode === 'ask' && row && 'id' in row && row.id != null) {
        void promptDestination(row.id, tab.title ?? tab.url);
      }
    } else if (info.menuItemId === 'br-save-link' && info.linkUrl) {
      const mode = await readCaptureMode();
      const destination = mode === 'ask' ? undefined : mode;
      const readingListAt = mode === 'ask' ? null : undefined;
      const row = await capture({
        url: info.linkUrl,
        source: 'context-menu',
        destination,
        readingListAt,
      });
      if (mode === 'ask' && row && 'id' in row && row.id != null) {
        void promptDestination(row.id, info.linkUrl);
      }
    }
  });
}
