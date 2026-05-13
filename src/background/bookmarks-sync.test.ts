import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertByHash = vi.fn();
const markRemoved = vi.fn();

vi.mock('../storage/bookmarks', () => ({
  markRemoved,
  upsertByHash,
}));

function listener<T extends (...args: never[]) => unknown>() {
  const callbacks: T[] = [];
  return {
    callbacks,
    addListener: vi.fn((callback: T) => callbacks.push(callback)),
  };
}

describe('Chrome bookmark sync', () => {
  const onCreated = listener<(id: string, node: chrome.bookmarks.BookmarkTreeNode) => void>();
  const onChanged = listener<(id: string, changeInfo: chrome.bookmarks.BookmarkChangeInfo) => void>();
  const onRemoved = listener<(id: string, removeInfo: chrome.bookmarks.BookmarkRemoveInfo) => void>();
  const onMoved = listener<(id: string, moveInfo: chrome.bookmarks.BookmarkMoveInfo) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    onCreated.callbacks.length = 0;
    onChanged.callbacks.length = 0;
    onRemoved.callbacks.length = 0;
    onMoved.callbacks.length = 0;
    const nodeIndex: Record<string, chrome.bookmarks.BookmarkTreeNode> = {
      '0': { id: '0', title: '' },
      '1': { id: '1', title: 'Bookmarks Bar', parentId: '0' },
      'reading-folder': { id: 'reading-folder', title: 'Reading', parentId: '1' },
      'tech-folder': { id: 'tech-folder', title: 'Tech', parentId: 'reading-folder' },
    };
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([
          {
            id: '0',
            title: '',
            children: [
              {
                id: '1',
                title: 'Bookmarks Bar',
                children: [
                  { id: '11', title: 'Example', url: 'https://example.com', dateAdded: 100 },
                  { id: '12', title: 'Chrome', url: 'chrome://extensions' },
                  {
                    id: 'folder',
                    title: 'Folder',
                    children: [{ id: '13', title: 'Nested', url: 'https://nested.example' }],
                  },
                ],
              },
            ],
          },
        ]),
        get: vi.fn(async (id: string) => {
          const node = nodeIndex[id];
          return node ? [node] : [];
        }),
        onCreated,
        onChanged,
        onRemoved,
        onMoved,
      },
    } as unknown as typeof chrome;
  });

  it('initially syncs only HTTP bookmark tree nodes and tags by folder path', async () => {
    const { initialSync } = await import('./bookmarks-sync');

    await expect(initialSync()).resolves.toEqual({ inserted: 2 });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://example.com',
      title: 'Example',
      source: 'chrome-bookmarks',
      capturedAt: 100,
      tags: undefined,
      chromeId: '11',
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://nested.example',
      title: 'Nested',
      source: 'chrome-bookmarks',
      capturedAt: expect.any(Number),
      tags: ['folder'],
      chromeId: '13',
    });
  });

  it('routine sync does not touch existing bookmark history', async () => {
    const { routineSync } = await import('./bookmarks-sync');

    await expect(routineSync()).resolves.toEqual({ inserted: 2 });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://example.com',
      title: 'Example',
      source: 'chrome-bookmarks',
      capturedAt: 100,
      tags: undefined,
      chromeId: '11',
      touchExisting: false,
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://nested.example',
      title: 'Nested',
      source: 'chrome-bookmarks',
      capturedAt: expect.any(Number),
      tags: ['folder'],
      chromeId: '13',
      touchExisting: false,
    });
  });

  it('registers bookmark listeners for created, changed, removed, and moved events', async () => {
    const { registerBookmarkListeners } = await import('./bookmarks-sync');
    registerBookmarkListeners();

    await onCreated.callbacks[0]?.('4', {
      id: '4',
      title: 'Created',
      url: 'https://created.example',
      dateAdded: 200,
    });
    await onCreated.callbacks[0]?.('6', {
      id: '6',
      title: '',
      url: 'https://created-no-title.example',
    });
    await onCreated.callbacks[0]?.('5', { id: '5', title: 'No URL' });
    await onChanged.callbacks[0]?.('4', {
      title: 'Changed',
      url: 'https://changed.example',
    });
    await onChanged.callbacks[0]?.('6', {
      title: '',
      url: 'https://changed-no-title.example',
    });
    await onChanged.callbacks[0]?.('x', { title: 'Chrome', url: 'chrome://version' });
    await onRemoved.callbacks[0]?.('4', {
      index: 0,
      parentId: '1',
      node: { id: '4', title: 'Removed', url: 'https://removed.example' },
    });
    await onRemoved.callbacks[0]?.('5', {
      index: 0,
      parentId: '1',
      node: { id: '5', title: 'No URL' },
    });
    onMoved.callbacks[0]?.('4', { index: 0, oldIndex: 1, parentId: '2', oldParentId: '1' });

    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://created.example',
      title: 'Created',
      source: 'chrome-bookmarks',
      capturedAt: 200,
      tags: undefined,
      chromeId: '4',
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://changed.example',
      title: 'Changed',
      source: 'chrome-bookmarks',
      chromeId: '4',
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://created-no-title.example',
      title: undefined,
      source: 'chrome-bookmarks',
      capturedAt: expect.any(Number),
      tags: undefined,
      chromeId: '6',
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://changed-no-title.example',
      title: undefined,
      source: 'chrome-bookmarks',
      chromeId: '6',
    });
    expect(markRemoved).toHaveBeenCalledTimes(1);
  });

  it('applies folder tags to newly created bookmarks and to moves', async () => {
    const { registerBookmarkListeners } = await import('./bookmarks-sync');
    registerBookmarkListeners();

    await onCreated.callbacks[0]?.('100', {
      id: '100',
      title: 'Deep link',
      url: 'https://deep.example',
      parentId: 'tech-folder',
      dateAdded: 500,
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://deep.example',
      title: 'Deep link',
      source: 'chrome-bookmarks',
      capturedAt: 500,
      tags: ['reading', 'tech'],
      chromeId: '100',
    });

    vi.mocked(chrome.bookmarks.get).mockResolvedValueOnce([
      {
        id: '101',
        title: 'Moved',
        url: 'https://moved.example',
        parentId: 'reading-folder',
      } as chrome.bookmarks.BookmarkTreeNode,
    ]);
    await onMoved.callbacks[0]?.('101', {
      parentId: 'reading-folder',
      oldParentId: 'tech-folder',
      index: 0,
      oldIndex: 1,
    });
    expect(upsertByHash).toHaveBeenCalledWith({
      url: 'https://moved.example',
      title: 'Moved',
      source: 'chrome-bookmarks',
      tags: ['reading'],
      touchExisting: false,
      chromeId: '101',
    });
  });
});
