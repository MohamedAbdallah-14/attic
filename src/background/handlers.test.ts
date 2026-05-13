import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, RuntimeMessage } from '../shared/types';

const handlers = new Map<string, (msg: RuntimeMessage) => Promise<unknown>>();
const upsertByHash = vi.fn();
const listFailedEnrichment = vi.fn();
const patch = vi.fn();
const backfillAutoTags = vi.fn();
const clearAll = vi.fn();
const countByEnrichment = vi.fn();
const markReadingList = vi.fn();
const unmarkReadingList = vi.fn();
const initialSync = vi.fn();
const routineSync = vi.fn();
const kickEnrichment = vi.fn();
const kickBurstEnrichment = vi.fn();
const claimSync = vi.fn();
const finishSync = vi.fn();
const releaseSync = vi.fn();
const hardDelete = vi.fn();
const getById = vi.fn();
const listAllFolders = vi.fn();
const findFolderByName = vi.fn();
const createFolderFn = vi.fn();
const moveBookmarkToFolder = vi.fn();
const removeChromeBookmark = vi.fn();

// Mock db with controllable store data
const bookmarkStoreData: Bookmark[] = [];
const imageStoreData: Array<{ urlHash: string; byteSize: number }> = [];

vi.mock('./messaging', () => ({
  on: vi.fn((type: string, handler: (msg: RuntimeMessage) => Promise<unknown>) => {
    handlers.set(type, handler);
  }),
}));

vi.mock('../storage/bookmarks', () => ({
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
}));

vi.mock('../storage/db', () => ({
  requestToPromise: vi.fn((req: { result: unknown }) => Promise.resolve(req.result)),
  withBookmarksStore: vi.fn(
    async (_mode: string, cb: (store: IDBObjectStore) => Promise<unknown>) => {
      const fakeStore = {
        getAll: () => ({ result: bookmarkStoreData }),
      } as unknown as IDBObjectStore;
      return cb(fakeStore);
    },
  ),
  withImagesStore: vi.fn(
    async (_mode: string, cb: (store: IDBObjectStore) => Promise<unknown>) => {
      const fakeStore = {
        getAll: () => ({ result: imageStoreData }),
        clear: () => ({ result: undefined }),
      } as unknown as IDBObjectStore;
      return cb(fakeStore);
    },
  ),
}));

vi.mock('./folders', () => ({
  listAllFolders,
  findFolderByName,
  createFolder: createFolderFn,
  moveBookmarkToFolder,
  removeChromeBookmark,
}));

vi.mock('./bookmarks-sync', () => ({ initialSync, routineSync }));
vi.mock('./enrichment', () => ({ kickEnrichment, kickBurstEnrichment }));
vi.mock('./sync-state', () => ({ claimSync, finishSync, releaseSync }));

function listener<T extends (...args: never[]) => unknown>() {
  const callbacks: T[] = [];
  return {
    callbacks,
    addListener: vi.fn((callback: T) => callbacks.push(callback)),
  };
}

describe('background handlers', () => {
  const command = listener<(command: string) => void | Promise<void>>();
  const contextClicked =
    listener<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void | Promise<void>>();
  const installed = listener<() => void>();
  const notificationButtonClicked =
    listener<(notifId: string, buttonIndex: number) => void | Promise<void>>();
  const create = vi.fn();
  const notifCreate = vi.fn().mockResolvedValue(undefined);
  const notifClear = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers.clear();
    bookmarkStoreData.length = 0;
    imageStoreData.length = 0;
    command.callbacks.length = 0;
    contextClicked.callbacks.length = 0;
    installed.callbacks.length = 0;
    notificationButtonClicked.callbacks.length = 0;
    upsertByHash.mockResolvedValue({ id: 42 });
    listFailedEnrichment.mockResolvedValue([]);
    initialSync.mockResolvedValue({ inserted: 3 });
    routineSync.mockResolvedValue({ inserted: 4 });
    backfillAutoTags.mockResolvedValue({ updated: 2 });
    claimSync.mockResolvedValue(true);
    finishSync.mockResolvedValue(undefined);
    releaseSync.mockResolvedValue(undefined);
    kickEnrichment.mockResolvedValue(undefined);

    globalThis.chrome = {
      commands: { onCommand: command },
      contextMenus: {
        create,
        onClicked: contextClicked,
      },
      notifications: {
        create: notifCreate,
        clear: notifClear,
        onButtonClicked: notificationButtonClicked,
      },
      runtime: {
        onInstalled: installed,
        getURL: vi.fn((path: string) => `chrome-extension://abc/${path}`),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: 'https://active.example', title: 'Active' }]),
      },
    } as unknown as typeof chrome;

    vi.resetModules();
    await import('./handlers');
  });

  it('captures valid URLs and skips non-http URLs', async () => {
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('capture')?.({
        type: 'capture',
        payload: { url: 'chrome://extensions', source: 'manual' },
      }),
    ).resolves.toEqual({ skipped: true, reason: 'non-http url' });
    expect(upsertByHash).not.toHaveBeenCalled();

    await expect(
      handlers.get('capture')?.({
        type: 'capture',
        payload: { url: 'https://example.com', title: 'Example', source: 'manual', tags: ['x'] },
      }),
    ).resolves.toEqual({ id: 42 });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://example.com',
      title: 'Example',
      source: 'manual',
      tags: ['x'],
      destination: undefined,
      readingListAt: undefined,
    });
    expect(kickEnrichment).toHaveBeenCalledTimes(1);
  });

  it('passes destination field through to upsertByHash', async () => {
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('capture')?.({
        type: 'capture',
        payload: { url: 'https://example.com', source: 'manual', destination: 'bookmarks' },
      }),
    ).resolves.toEqual({ id: 42 });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://example.com',
      title: undefined,
      source: 'manual',
      tags: undefined,
      destination: 'bookmarks',
      readingListAt: undefined,
    });
  });

  it('reruns failed enrichment, resyncs, clears, and imports Pocket rows', async () => {
    listFailedEnrichment.mockResolvedValue([{ id: 7 }, { id: undefined }, { id: 9 }]);
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('rerun-failed-enrichment')?.({ type: 'rerun-failed-enrichment' }),
    ).resolves.toEqual({ reset: 3 });
    expect(patch).toHaveBeenCalledWith(7, { enrichment: 'pending', enrichmentAttempts: 0 });
    expect(patch).toHaveBeenCalledWith(9, { enrichment: 'pending', enrichmentAttempts: 0 });

    await expect(handlers.get('resync-bookmarks')?.({ type: 'resync-bookmarks' })).resolves.toEqual({
      inserted: 3,
    });
    await expect(handlers.get('clear-all')?.({ type: 'clear-all' })).resolves.toEqual({ ok: true });
    expect(clearAll).toHaveBeenCalledTimes(1);

    await expect(
      handlers.get('import-pocket')?.({
        type: 'import-pocket',
        payload: {
          rows: [
            {
              url: 'https://pocket.example',
              title: 'Pocket',
              capturedAt: 123,
              tags: ['reading'],
            },
          ],
        },
      }),
    ).resolves.toEqual({ inserted: 1 });
    expect(upsertByHash).toHaveBeenLastCalledWith({
      url: 'https://pocket.example',
      title: 'Pocket',
      source: 'pocket-import',
      capturedAt: 123,
      tags: ['reading'],
    });
  });

  it('registers command and context menu capture surfaces', async () => {
    const { registerContextMenus, registerHandlers } = await import('./handlers');
    registerHandlers();
    registerContextMenus();

    installed.callbacks[0]?.();
    expect(create).toHaveBeenCalledWith({
      id: 'br-save-page',
      title: 'Save page to feed',
      contexts: ['page'],
    });
    expect(create).toHaveBeenCalledWith({
      id: 'br-save-link',
      title: 'Save link to feed',
      contexts: ['link'],
    });

    await command.callbacks[0]?.('ignored-command');
    expect(upsertByHash).not.toHaveBeenCalled();
    await command.callbacks[0]?.('save-current-page');
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://active.example',
      title: 'Active',
      source: 'shortcut',
      tags: undefined,
      destination: undefined,
      readingListAt: null,
    });

    await contextClicked.callbacks[0]?.(
      { menuItemId: 'br-save-page' } as chrome.contextMenus.OnClickData,
      { url: 'https://page.example', title: 'Page' } as chrome.tabs.Tab,
    );
    await contextClicked.callbacks[0]?.({
      menuItemId: 'br-save-link',
      linkUrl: 'https://link.example',
    } as chrome.contextMenus.OnClickData);
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://page.example',
      title: 'Page',
      source: 'context-menu',
      tags: undefined,
      destination: undefined,
      readingListAt: null,
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://link.example',
      title: undefined,
      source: 'context-menu',
      tags: undefined,
      destination: undefined,
      readingListAt: null,
    });
  });

  it('runs throttled maintenance sync only after claiming the sync lock', async () => {
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('maybe-sync-bookmarks')?.({ type: 'maybe-sync-bookmarks' }),
    ).resolves.toEqual({ synced: true, inserted: 4, tagged: 2 });
    expect(routineSync).toHaveBeenCalled();
    expect(backfillAutoTags).toHaveBeenCalled();
    expect(kickEnrichment).toHaveBeenCalled();
    expect(finishSync).toHaveBeenCalled();

    vi.clearAllMocks();
    claimSync.mockResolvedValue(false);
    await expect(
      handlers.get('maybe-sync-bookmarks')?.({ type: 'maybe-sync-bookmarks' }),
    ).resolves.toEqual({ synced: false, inserted: 0, tagged: 0 });
    expect(routineSync).not.toHaveBeenCalled();
  });

  it('releases the sync lock when maintenance sync fails', async () => {
    routineSync.mockRejectedValueOnce(new Error('bookmarks unavailable'));
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('maybe-sync-bookmarks')?.({ type: 'maybe-sync-bookmarks' }),
    ).rejects.toThrow('bookmarks unavailable');
    expect(releaseSync).toHaveBeenCalled();
  });

  it('reports enrichment status and kicks a burst pass', async () => {
    countByEnrichment.mockImplementation((status: string) =>
      Promise.resolve(status === 'pending' ? 5 : status === 'ok' ? 10 : 2),
    );
    kickBurstEnrichment.mockResolvedValue({ processed: 7 });
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('enrichment-status')?.({ type: 'enrichment-status' }),
    ).resolves.toEqual({ pending: 5, ok: 10, failed: 2 });

    await expect(
      handlers.get('kick-burst-enrichment')?.({ type: 'kick-burst-enrichment' }),
    ).resolves.toEqual({ processed: 7 });
    expect(kickBurstEnrichment).toHaveBeenCalled();
  });

  it('handles tag updates, folder moves, folder creation, and deletes', async () => {
    getById.mockResolvedValue({ id: 12, chromeId: 'c-12', url: 'https://x' });
    listAllFolders.mockResolvedValue([{ id: 'ai', title: 'AI', path: ['AI'] }]);
    findFolderByName.mockImplementation((name: string) =>
      Promise.resolve(name.toLowerCase() === 'ai' ? { id: 'ai', title: 'AI', path: ['AI'] } : undefined),
    );
    createFolderFn.mockResolvedValue({ id: 'new', title: 'New' });

    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('list-folders')?.({ type: 'list-folders' }),
    ).resolves.toEqual([{ id: 'ai', title: 'AI', path: ['AI'] }]);

    await expect(
      handlers.get('update-tags')?.({
        type: 'update-tags',
        payload: { bookmarkId: 12, tags: ['ai', 'reading'] },
      }),
    ).resolves.toEqual({ moved: true, folderTitle: 'AI' });
    expect(patch).toHaveBeenCalledWith(12, { tags: ['ai', 'reading'] });
    expect(moveBookmarkToFolder).toHaveBeenCalledWith('c-12', 'ai');

    await expect(
      handlers.get('apply-folder-tag')?.({
        type: 'apply-folder-tag',
        payload: { bookmarkId: 12, folderId: 'reading' },
      }),
    ).resolves.toEqual({ moved: true });
    expect(moveBookmarkToFolder).toHaveBeenCalledWith('c-12', 'reading');

    await expect(
      handlers.get('create-folder-and-move')?.({
        type: 'create-folder-and-move',
        payload: { bookmarkId: 12, title: 'Newish', parentId: '1' },
      }),
    ).resolves.toEqual({ moved: true, folderId: 'new' });
    expect(createFolderFn).toHaveBeenCalledWith('Newish', '1');
    expect(moveBookmarkToFolder).toHaveBeenCalledWith('c-12', 'new');

    await expect(
      handlers.get('delete-bookmark')?.({
        type: 'delete-bookmark',
        payload: { bookmarkId: 12, scope: 'both' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(removeChromeBookmark).toHaveBeenCalledWith('c-12');
    expect(hardDelete).toHaveBeenCalledWith(12);
  });

  it('apply-folder-tag is a no-op when the row has no chromeId', async () => {
    getById.mockResolvedValueOnce({ id: 13, url: 'https://x' });
    const { registerHandlers } = await import('./handlers');
    registerHandlers();
    await expect(
      handlers.get('apply-folder-tag')?.({
        type: 'apply-folder-tag',
        payload: { bookmarkId: 13, folderId: 'reading' },
      }),
    ).resolves.toEqual({ moved: false });
    expect(moveBookmarkToFolder).not.toHaveBeenCalled();
  });

  it('returns moved: false when no tag matches a folder', async () => {
    getById.mockResolvedValue({ id: 14, chromeId: 'c-14', url: 'https://x' });
    findFolderByName.mockResolvedValue(undefined);
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('update-tags')?.({
        type: 'update-tags',
        payload: { bookmarkId: 14, tags: ['nofolder'] },
      }),
    ).resolves.toEqual({ moved: false });
    expect(moveBookmarkToFolder).not.toHaveBeenCalled();
  });

  it('tolerates a Chrome remove failure during delete-bookmark with scope=both', async () => {
    getById.mockResolvedValue({ id: 15, chromeId: 'c-15', url: 'https://x' });
    removeChromeBookmark.mockRejectedValueOnce(new Error('bookmark gone'));
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('delete-bookmark')?.({
        type: 'delete-bookmark',
        payload: { bookmarkId: 15, scope: 'both' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(hardDelete).toHaveBeenCalledWith(15);
  });

  it('returns not-found when delete-bookmark row is missing', async () => {
    getById.mockResolvedValue(undefined);
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('delete-bookmark')?.({
        type: 'delete-bookmark',
        payload: { bookmarkId: 99, scope: 'attic' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'not found' });
    expect(hardDelete).not.toHaveBeenCalled();
  });

  it('create-folder-and-move is a no-op when the row has no chromeId', async () => {
    getById.mockResolvedValueOnce({ id: 16, url: 'https://x' });
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('create-folder-and-move')?.({
        type: 'create-folder-and-move',
        payload: { bookmarkId: 16, title: 'Foo', parentId: '1' },
      }),
    ).resolves.toEqual({ moved: false });
    expect(createFolderFn).not.toHaveBeenCalled();
  });

  it('skips br-save-page when the tab has no url', async () => {
    const { registerContextMenus, registerHandlers } = await import('./handlers');
    registerHandlers();
    registerContextMenus();

    await contextClicked.callbacks[0]?.(
      { menuItemId: 'br-save-page' } as chrome.contextMenus.OnClickData,
      { title: 'No URL' } as chrome.tabs.Tab,
    );
    expect(upsertByHash).not.toHaveBeenCalled();
  });

  it('popup-stats counts active, reading, and done bookmarks', async () => {
    const now = Date.now();
    bookmarkStoreData.push(
      { id: 1, url: 'https://a.com', urlHash: 'a', title: 'A', source: 'manual', capturedAt: now, shownCount: 0, enrichment: 'ok', enrichmentAttempts: 0, readingListAt: now } as Bookmark,
      { id: 2, url: 'https://b.com', urlHash: 'b', title: 'B', source: 'manual', capturedAt: now, shownCount: 0, enrichment: 'ok', enrichmentAttempts: 0, consumedAt: now } as Bookmark,
      { id: 3, url: 'https://c.com', urlHash: 'c', title: 'C', source: 'manual', capturedAt: now, shownCount: 0, enrichment: 'ok', enrichmentAttempts: 0, removed: true } as Bookmark,
    );
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('popup-stats')?.({ type: 'popup-stats' }),
    ).resolves.toEqual({ bookmarks: 2, reading: 1, done: 1 });
  });

  it('toggles reading-list membership', async () => {
    markReadingList.mockResolvedValue(undefined);
    unmarkReadingList.mockResolvedValue(undefined);
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('toggle-reading-list')?.({
        type: 'toggle-reading-list',
        payload: { bookmarkId: 5, add: true },
      }),
    ).resolves.toEqual({ ok: true });
    expect(markReadingList).toHaveBeenCalledWith(5);

    await expect(
      handlers.get('toggle-reading-list')?.({
        type: 'toggle-reading-list',
        payload: { bookmarkId: 5, add: false },
      }),
    ).resolves.toEqual({ ok: true });
    expect(unmarkReadingList).toHaveBeenCalledWith(5);
  });

  it('image-cache-stats returns count and total bytes from images store', async () => {
    imageStoreData.push(
      { urlHash: 'h1', byteSize: 10000 },
      { urlHash: 'h2', byteSize: 5000 },
    );
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('image-cache-stats')?.({ type: 'image-cache-stats' }),
    ).resolves.toEqual({ count: 2, bytes: 15000 });
  });

  it('local-activity counts captures and done in last 7 days plus total shown', async () => {
    const now = Date.now();
    const sevenAgo = now - 7 * 24 * 60 * 60 * 1000;
    bookmarkStoreData.push(
      { id: 1, url: 'https://a.com', urlHash: 'a', title: 'A', source: 'manual', capturedAt: now, shownCount: 3, enrichment: 'ok', enrichmentAttempts: 0 } as Bookmark,
      { id: 2, url: 'https://b.com', urlHash: 'b', title: 'B', source: 'manual', capturedAt: now, shownCount: 2, consumedAt: now, enrichment: 'ok', enrichmentAttempts: 0 } as Bookmark,
      { id: 3, url: 'https://c.com', urlHash: 'c', title: 'C', source: 'manual', capturedAt: sevenAgo - 1000, shownCount: 1, enrichment: 'ok', enrichmentAttempts: 0 } as Bookmark,
    );
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('local-activity')?.({ type: 'local-activity' }),
    ).resolves.toEqual({ capturesWeek: 2, doneWeek: 1, shownTotal: 6 });
  });

  it('export-data returns all bookmarks with exportedAt timestamp', async () => {
    const now = Date.now();
    bookmarkStoreData.push(
      { id: 1, url: 'https://a.com', urlHash: 'a', title: 'A', source: 'manual', capturedAt: now, shownCount: 0, enrichment: 'ok', enrichmentAttempts: 0 } as Bookmark,
    );
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    const result = await handlers.get('export-data')?.({ type: 'export-data' }) as { bookmarks: Bookmark[]; exportedAt: number } | undefined;
    expect(result?.bookmarks).toHaveLength(1);
    expect(result?.bookmarks[0]?.url).toBe('https://a.com');
    expect(typeof result?.exportedAt).toBe('number');
  });

  it('clear-all also clears the images store', async () => {
    const { withImagesStore } = await import('../storage/db');
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await expect(
      handlers.get('clear-all')?.({ type: 'clear-all' }),
    ).resolves.toEqual({ ok: true });
    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(withImagesStore).toHaveBeenCalledWith('readwrite', expect.any(Function));
  });

  it('shortcut capture fires notification and skips reading-list auto-add when mode is ask', async () => {
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await command.callbacks[0]?.('save-current-page');
    expect(notifCreate).toHaveBeenCalledWith(
      'attic-capture-42',
      expect.objectContaining({ type: 'basic', title: 'Saved to Attic' }),
    );
    // Ask mode must not silently land the row on the reading list before the user picks
    expect(upsertByHash).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'shortcut', destination: undefined, readingListAt: null }),
    );
  });

  it('shortcut capture does not fire notification when mode is reading', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ atticCaptureMode: 'reading' });
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await command.callbacks[0]?.('save-current-page');
    expect(notifCreate).not.toHaveBeenCalled();
    expect(upsertByHash).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'reading', readingListAt: undefined }),
    );
  });

  it('notification button 0 marks reading list; button 1 clears it', async () => {
    patch.mockResolvedValue(undefined);
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await notificationButtonClicked.callbacks[0]?.('attic-capture-42', 0);
    expect(patch).toHaveBeenCalledWith(42, { readingListAt: expect.any(Number) });
    expect(notifClear).toHaveBeenCalledWith('attic-capture-42');

    patch.mockClear();
    notifClear.mockClear();

    await notificationButtonClicked.callbacks[0]?.('attic-capture-42', 1);
    expect(patch).toHaveBeenCalledWith(42, { readingListAt: undefined });
    expect(notifClear).toHaveBeenCalledWith('attic-capture-42');
  });

  it('notification creation failure defaults the saved row to Reading list', async () => {
    notifCreate.mockRejectedValueOnce(new Error('notifications denied'));
    patch.mockResolvedValue(undefined);
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await command.callbacks[0]?.('save-current-page');
    // Settle the promiseDestination awaiter chain
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(patch).toHaveBeenCalledWith(42, { readingListAt: expect.any(Number) });
  });

  it('notification button click ignores unrelated notification ids', async () => {
    const { registerHandlers } = await import('./handlers');
    registerHandlers();

    await notificationButtonClicked.callbacks[0]?.('some-other-notif', 0);
    expect(patch).not.toHaveBeenCalled();
  });
});
