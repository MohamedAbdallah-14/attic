import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '../shared/types';

const listForFeed = vi.fn<() => Promise<Bookmark[]>>();
const incrementShown = vi.fn();
const patch = vi.fn();

const baseBookmarks: Bookmark[] = [
  {
    id: 1,
    url: 'https://example.com/a',
    urlHash: 'a',
    title: 'Alpha article',
    description: 'A thoughtful note about design',
    imageUrl: 'https://example.com/a.jpg',
    faviconUrl: 'https://example.com/favicon.ico',
    siteName: 'Example',
    source: 'manual',
    capturedAt: 1_000,
    shownCount: 0,
    tags: ['design'],
    snapshotText: 'archive design',
    enrichment: 'ok',
    enrichmentAttempts: 1,
  },
  {
    id: 2,
    url: 'https://youtube.com/watch?v=1',
    urlHash: 'b',
    title: 'Beta video',
    description: 'Video description',
    source: 'site:youtube',
    capturedAt: 2_000,
    shownCount: 1,
    tags: ['video'],
    enrichment: 'pending',
    enrichmentAttempts: 0,
  },
];

const getCachedImage = vi.fn<(hash: string) => Promise<{ blob: Blob } | undefined>>();

vi.mock('../storage/bookmarks', () => ({
  incrementShown,
  listForFeed,
  patch,
}));

vi.mock('../storage/images', () => ({
  getCachedImage,
}));

describe('new tab UI', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    document.body.innerHTML = '<div id="root"></div>';
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        openOptionsPage: vi.fn(),
      },
    } as unknown as typeof chrome;
    globalThis.IntersectionObserver = vi.fn((callback: IntersectionObserverCallback) => ({
      disconnect: vi.fn(),
      observe: vi.fn(() =>
        callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver),
      ),
      takeRecords: vi.fn(() => []),
      unobserve: vi.fn(),
      root: null,
      rootMargin: '0px',
      thresholds: [],
    })) as unknown as typeof IntersectionObserver;
    vi.stubGlobal('open', vi.fn());
  });

  it('renders the archive feed, filters results, edits tags, and toggles theme', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    expect(document.body.textContent).toContain('Attic');
    expect(document.body.textContent).toContain('Alpha article');
    expect(document.body.textContent).toContain('Beta video');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'maybe-sync-bookmarks' });
    expect(incrementShown).toHaveBeenCalledWith(1);
    expect(incrementShown).toHaveBeenCalledWith(2);

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'video';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.body.textContent).toContain('Library results');
    expect(document.body.textContent).not.toContain('Alpha article');
    expect(document.body.textContent).toContain('Beta video');

    search.value = 'does-not-exist';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.body.textContent).toContain('No saved links match that');

    const settingsButton = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Open settings',
    );
    settingsButton?.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const youtubeChip = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'youtube',
    );
    youtubeChip?.click();
    expect(document.body.textContent).toContain('Beta video');
    expect(document.body.textContent).not.toContain('Alpha article');

    const tagTrigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tags',
    );
    tagTrigger?.click();
    const tagRow = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.startsWith('#video'),
    );
    tagRow?.click();

    const editTags = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Edit tags'),
    );
    editTags?.click();
    const tagsInput = document.querySelector<HTMLInputElement>('#attic-tags-input')!;
    tagsInput.value = 'video, reference';
    document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    await Promise.resolve();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'update-tags',
      payload: { bookmarkId: 2, tags: ['video', 'reference'] },
    });

    expect(document.body.textContent).toContain('youtube.com');
  });

  it('supports keyboard help, opening, and mark-done shortcuts outside form controls', async () => {
    const readingItem = { ...baseBookmarks[0]!, id: 5, urlHash: 'rl', title: 'Reading item', readingListAt: 1000 };
    listForFeed.mockResolvedValue([readingItem, ...baseBookmarks]);
    await import('./main');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    expect(document.body.textContent).toContain('Keyboard shortcuts');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.textContent).not.toContain('Keyboard shortcuts');

    // m key is a no-op on discover tab
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    expect(patch).not.toHaveBeenCalled();

    // Navigate to reading list tab so m works
    const readingTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reading list',
    );
    readingTab?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    // Cmd-Enter opens in new tab
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    expect(open).toHaveBeenCalledWith(readingItem.url, '_blank');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    expect(patch).toHaveBeenCalledWith(readingItem.id, { consumedAt: expect.any(Number) });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }));
    expect(document.body.textContent).toContain('Reading item');

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(document.body.textContent).toContain('Reading item');
  });

  it('clicks anywhere on a card to open; modifier opens new tab', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    const card = document.querySelector<HTMLElement>('article')!;

    // Test: plain click on card should not trigger window.open (same-tab opens via location.href)
    // We'll verify this by checking that window.open is NOT called for a plain click
    const callCountBefore = (open as any).mock.calls.length;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const callCountAfter = (open as any).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore); // No new calls to window.open

    // Test: modifier click on card opens in new tab
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank');

    // Test: middle-click via auxclick opens in new tab
    (open as ReturnType<typeof vi.fn>).mockClear();
    card.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank');

    // Test: non-middle auxclick (e.g. right click button=2) is a no-op
    (open as ReturnType<typeof vi.fn>).mockClear();
    card.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(open).not.toHaveBeenCalled();

    // Test: auxclick on interactive descendant does not open the bookmark
    (open as ReturnType<typeof vi.fn>).mockClear();
    const innerButton = card.querySelector('button')!;
    innerButton.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(open).not.toHaveBeenCalled();

    // Test: interactive elements (buttons) don't trigger card click handler
    const editBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Edit tags')!;
    const callCountBeforeBtn = (open as any).mock.calls.length;
    editBtn.click();
    const callCountAfterBtn = (open as any).mock.calls.length;
    expect(callCountAfterBtn).toBe(callCountBeforeBtn); // No bookmark opening
  });

  it('renders empty state and resyncs bookmarks', async () => {
    listForFeed.mockResolvedValueOnce([]).mockResolvedValueOnce(baseBookmarks);
    await import('./main');

    expect(document.body.textContent).toContain('Your attic is empty');
    document.querySelector<HTMLButtonElement>('button')?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'resync-bookmarks' });
    expect(document.body.textContent).toContain('Alpha article');
  });

  it('handles an exhausted feed when all candidates have zero weight', async () => {
    listForFeed.mockResolvedValue([{ ...baseBookmarks[0]!, removed: true }]);
    await import('./main');

    // Store has items but none are showable — discover inline empty, NOT global takeover
    expect(document.body.textContent).toContain('Nothing left in this session');
    expect(document.body.textContent).not.toContain('Your attic is empty');
  });

  it('opens the tag dropdown, filters tags, clears the tag, and changes accent', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    const tagTrigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tags',
    );
    tagTrigger?.click();

    const tagSearch = document.querySelector<HTMLInputElement>(
      'input[placeholder="Filter tags..."]',
    );
    expect(tagSearch).not.toBeNull();
    tagSearch!.value = 'des';
    tagSearch!.dispatchEvent(new Event('input', { bubbles: true }));
    const menu = tagSearch!.parentElement!;
    expect(menu.textContent).toContain('#design');
    expect(menu.textContent).not.toContain('#video');

    const designRow = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('#design'),
    );
    designRow?.click();
    expect(document.body.textContent).toContain('Library results');
    expect(document.body.textContent).toContain('Alpha article');
    expect(document.body.textContent).not.toContain('Beta video');

    const clear = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === '×',
    );
    clear?.click();
    expect(document.body.textContent).toContain('Today from the attic');

    const settingsButton = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Open settings',
    );
    settingsButton?.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('syncs theme and accent from localStorage when the options page updates them', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    // No-op when storage event fires but nothing has changed — exercises the early-return branch
    const colorBefore = document.documentElement.style.colorScheme;
    window.dispatchEvent(new StorageEvent('storage'));
    expect(document.documentElement.style.colorScheme).toBe(colorBefore);

    // Simulate the options page writing new theme + accent, then dispatching a storage event
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === 'attic-theme-preference') return 'light';
      if (key === 'attic-accent') return '#22c1a0';
      return null;
    });
    window.dispatchEvent(new StorageEvent('storage'));
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--attic-accent')).toBe('#22c1a0');
  });

  it('reveals more from the archive when the user clicks show more', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    expect(document.body.textContent).toContain('Today from the attic');
    const reveal = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Show more from your archive',
    );
    reveal?.click();
    await Promise.resolve();
    expect(document.body.textContent).toContain('From your archive');
  });

  it('shows the enrichment banner when work is pending and can speed it up', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'enrichment-status') {
            return Promise.resolve({ ok: true, data: { pending: 3, ok: 1, failed: 0 } });
          }
          return Promise.resolve({ ok: true });
        }),
      },
    } as unknown as typeof chrome;
    await import('./main');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Enriching links');
    const speedUp = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Speed up',
    );
    speedUp?.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'kick-burst-enrichment' });
  });

  it('closes the tag menu on Escape', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    const tagTrigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tags',
    );
    tagTrigger?.click();
    expect(document.querySelector('input[placeholder="Filter tags..."]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('input[placeholder="Filter tags..."]')).toBeNull();
  });

  it('prompts to create a matching Chrome folder when none exists', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'update-tags') return Promise.resolve({ ok: true, data: { moved: false } });
          if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: [] });
          return Promise.resolve({ ok: true });
        }),
      },
    } as unknown as typeof chrome;
    baseBookmarks[1]!.chromeId = 'c-2';
    await import('./main');

    const editTagsButtons = [...document.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Edit tags'),
    );
    // Click the second "Edit tags" button (Beta video, which has chromeId set)
    editTagsButtons[1]?.click();
    const input = document.querySelector<HTMLInputElement>('#attic-tags-input')!;
    input.value = 'video, newone';
    document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Create a "newone" folder');
  });

  it('confirms deletion via the delete icon and removes the row', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }),
      },
    } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const deleteIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Delete bookmark',
    );
    deleteIcon?.click();
    const both = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete in Attic and Chrome',
    );
    both?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'delete-bookmark',
      payload: { bookmarkId: 1, scope: 'both' },
    });
    expect(document.body.textContent).not.toContain('Alpha article');
  });

  it('switches between Discover, Bookmarks, Reading list, and Done tabs', async () => {
    listForFeed.mockResolvedValue([
      { ...baseBookmarks[0]!, id: 10, urlHash: 'p', title: 'Bookmark only', readingListAt: undefined },
      { ...baseBookmarks[0]!, id: 11, urlHash: 'q', title: 'On reading list', readingListAt: 5 },
      { ...baseBookmarks[0]!, id: 12, urlHash: 'r', title: 'Closed item', readingListAt: 5, consumedAt: 6 },
    ]);
    await import('./main');

    const bookmarksTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Bookmarks',
    );
    bookmarksTab?.click();
    expect(document.body.textContent).toContain('Your bookmarks');
    expect(document.body.textContent).toContain('Bookmark only');
    expect(document.body.textContent).toContain('On reading list');

    const readingTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reading list',
    );
    readingTab?.click();
    expect(document.body.textContent).toContain('On reading list');
    expect(document.body.textContent).not.toContain('Bookmark only');
    expect(document.body.textContent).not.toContain('Closed item');

    const doneTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Done',
    );
    doneTab?.click();
    expect(document.body.textContent).toContain('Closed item');
    expect(document.body.textContent).not.toContain('Bookmark only');
  });

  it('renders the saved light theme on startup', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('light');
    listForFeed.mockResolvedValue(baseBookmarks);

    await import('./main');

    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.body.textContent).toContain('Alpha article');
  });

  it('deletes immediately when the user has a remembered delete scope', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }) },
    } as unknown as typeof chrome;
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === 'attic-delete-scope' ? 'attic' : null,
    );
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const deleteIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Delete bookmark',
    );
    deleteIcon?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'delete-bookmark',
      payload: { bookmarkId: 1, scope: 'attic' },
    });
  });

  it('opens the keyboard shortcuts overlay via the ? button and closes via Close and backdrop', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    const helpButton = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Show keyboard shortcuts',
    );
    helpButton?.click();
    expect(document.body.textContent).toContain('Keyboard shortcuts');

    // Close via the Close button inside the overlay
    const closeBtn = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Close',
    );
    closeBtn?.click();
    expect(document.body.textContent).not.toContain('Keyboard shortcuts');

    // Re-open and dismiss via overlay backdrop
    helpButton?.click();
    expect(document.body.textContent).toContain('Keyboard shortcuts');
    const overlay = document.querySelector<HTMLElement>('.fixed.inset-0');
    overlay?.click();
    expect(document.body.textContent).not.toContain('Keyboard shortcuts');
  });

  it('gear button opens the chrome options page directly (no inline theme panel)', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    const settingsButton = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Open settings',
    );
    settingsButton?.click();

    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    // The inline theme panel should no longer appear in the newtab
    expect(document.body.textContent).not.toContain('Theme settings');
  });

  it('cancels tag editing via the Cancel button and overlay backdrop', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    // Open via Edit tags button
    const editTagsButtons = [...document.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Edit tags'),
    );
    editTagsButtons[0]?.click();
    expect(document.querySelector('#attic-tags-input')).not.toBeNull();

    // Cancel button dismisses
    const cancelBtn = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    cancelBtn?.click();
    expect(document.querySelector('#attic-tags-input')).toBeNull();

    // Re-open and dismiss via overlay backdrop
    editTagsButtons[0]?.click();
    expect(document.querySelector('#attic-tags-input')).not.toBeNull();
    const overlay = document.querySelector<HTMLElement>('.fixed.inset-0');
    overlay?.click();
    expect(document.querySelector('#attic-tags-input')).toBeNull();
  });

  it('dismisses the folder prompt by clicking the backdrop', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'update-tags') return Promise.resolve({ ok: true, data: { moved: false } });
          if (msg.type === 'list-folders')
            return Promise.resolve({ ok: true, data: [{ id: '1', title: 'Bookmarks Bar', path: ['Bookmarks Bar'] }] });
          return Promise.resolve({ ok: true });
        }),
      },
    } as unknown as typeof chrome;
    baseBookmarks[1]!.chromeId = 'c-2';
    await import('./main');

    const editTagsButtons = [...document.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Edit tags'),
    );
    editTagsButtons[1]?.click();
    const input = document.querySelector<HTMLInputElement>('#attic-tags-input')!;
    input.value = 'video, newone';
    document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Create a "newone" folder');

    const overlay = document.querySelector<HTMLElement>('.fixed.inset-0');
    overlay?.click();
    expect(document.body.textContent).not.toContain('Create a "newone" folder');
  });

  it('dismisses the folder prompt via Keep tag only', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'update-tags') return Promise.resolve({ ok: true, data: { moved: false } });
          if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: [] });
          return Promise.resolve({ ok: true });
        }),
      },
    } as unknown as typeof chrome;
    baseBookmarks[1]!.chromeId = 'c-2';
    await import('./main');

    const editTagsButtons = [...document.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Edit tags'),
    );
    editTagsButtons[1]?.click();
    const input = document.querySelector<HTMLInputElement>('#attic-tags-input')!;
    input.value = 'video, newone';
    document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Create a "newone" folder');

    const keepBtn = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Keep tag only',
    );
    keepBtn?.click();
    expect(document.body.textContent).not.toContain('Create a "newone" folder');
  });

  it('creates a folder via the folder prompt', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'update-tags') return Promise.resolve({ ok: true, data: { moved: false } });
          if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: [] });
          if (msg.type === 'create-folder-and-move') return Promise.resolve({ ok: true });
          return Promise.resolve({ ok: true });
        }),
      },
    } as unknown as typeof chrome;
    baseBookmarks[1]!.chromeId = 'c-2';
    await import('./main');

    const editTagsButtons = [...document.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Edit tags'),
    );
    editTagsButtons[1]?.click();
    const input = document.querySelector<HTMLInputElement>('#attic-tags-input')!;
    input.value = 'video, newone';
    document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Create a "newone" folder');

    const createBtn = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Create folder and move',
    );
    createBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'create-folder-and-move' }),
    );
  });

  it('cancels the delete confirm dialog without deleting', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }) },
    } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const deleteIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Delete bookmark',
    );
    deleteIcon?.click();
    expect(document.body.textContent).toContain('Delete bookmark?');

    const cancelBtn = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    cancelBtn?.click();
    expect(document.body.textContent).not.toContain('Delete bookmark?');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'delete-bookmark' }),
    );
  });

  it('deletes in Attic only via the confirm dialog', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }) },
    } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const deleteIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Delete bookmark',
    );
    deleteIcon?.click();
    const atticOnly = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete in Attic only',
    );
    atticOnly?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'delete-bookmark',
      payload: { bookmarkId: 1, scope: 'attic' },
    });
  });

  it('Done tab includes consumed rows even when they have no readingListAt', async () => {
    // Brief: Done = all rows with consumedAt set, regardless of readingListAt
    const consumedNoReading = {
      ...baseBookmarks[0]!,
      id: 99,
      urlHash: 'consumed-no-reading',
      title: 'Consumed without reading list',
      consumedAt: 5000,
      readingListAt: undefined,
    };
    const consumedAndReading = {
      ...baseBookmarks[1]!,
      id: 100,
      urlHash: 'consumed-and-reading',
      title: 'Consumed from reading list',
      consumedAt: 6000,
      readingListAt: 4000,
    };
    listForFeed.mockResolvedValue([consumedNoReading, consumedAndReading]);
    await import('./main');

    const doneTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Done',
    );
    doneTab?.click();

    expect(document.body.textContent).toContain('Consumed without reading list');
    expect(document.body.textContent).toContain('Consumed from reading list');
  });

  it('dismisses the delete confirm dialog by clicking the backdrop', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }) },
    } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const deleteIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Delete bookmark',
    );
    deleteIcon?.click();
    expect(document.body.textContent).toContain('Delete bookmark?');

    // Click the overlay backdrop (the fixed inset-0 element)
    const overlay = document.querySelector<HTMLElement>('.fixed.inset-0');
    overlay?.click();
    expect(document.body.textContent).not.toContain('Delete bookmark?');
  });

  it('shows no-matching-tags state and clears via All tags row click', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');

    const tagTrigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tags',
    );
    tagTrigger?.click();

    const tagSearch = document.querySelector<HTMLInputElement>('input[placeholder="Filter tags..."]');
    expect(tagSearch).not.toBeNull();
    tagSearch!.value = 'zzznomatch';
    tagSearch!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.body.textContent).toContain('No matching tags');

    // Reopen and click "All tags" row to reset filter
    tagTrigger?.click();
    tagTrigger?.click();
    const allTagsRow = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.startsWith('All tags'),
    );
    allTagsRow?.click();
    expect(document.body.textContent).toContain('Today from the attic');
  });

  it('filters by source when multiple sources are present', async () => {
    const multiSource = [
      { ...baseBookmarks[0]!, source: 'manual' as const },
      { ...baseBookmarks[1]!, source: 'chrome-bookmarks' as const },
    ];
    listForFeed.mockResolvedValue(multiSource);
    await import('./main');

    const bookmarksTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Bookmarks',
    );
    bookmarksTab?.click();

    const allSourcesChip = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'All sources',
    );
    expect(allSourcesChip).toBeDefined();
    allSourcesChip?.click();
    expect(document.body.textContent).toContain('Your bookmarks');
  });

  it('opens the folder picker from the per-card menu and moves the bookmark on selection', async () => {
    const folders = [
      { id: 'ai', title: 'AI', path: ['AI'] },
      { id: 'reading', title: 'Reading', path: ['Reading'] },
    ];
    const sendMessage = vi.fn().mockImplementation((msg: { type: string }) => {
      if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: folders });
      return Promise.resolve({ ok: true });
    });
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const moveIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Move to Chrome folder',
    );
    moveIcon?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Move to Chrome folder');
    expect(document.body.textContent).toContain('AI');
    expect(document.body.textContent).toContain('Reading');

    const aiRow = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('AI'),
    );
    aiRow?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'apply-folder-tag',
      payload: { bookmarkId: 1, folderId: 'ai' },
    });
  });

  it('shows empty-folder state in the folder picker when Chrome has no folders', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: { type: string }) => {
      if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: [] });
      return Promise.resolve({ ok: true });
    });
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const moveIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Move to Chrome folder',
    );
    moveIcon?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Move to Chrome folder');
    expect(document.body.textContent).toContain('No folders in Chrome yet.');
  });

  it('filters folders by search query in the folder picker', async () => {
    const folders = [
      { id: 'ai', title: 'AI', path: ['AI'] },
      { id: 'reading', title: 'Reading', path: ['Reading'] },
    ];
    const sendMessage = vi.fn().mockImplementation((msg: { type: string }) => {
      if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: folders });
      return Promise.resolve({ ok: true });
    });
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const moveIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Move to Chrome folder',
    );
    moveIcon?.click();
    await new Promise((r) => setTimeout(r, 0));

    const searchInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search folders..."]',
    );
    expect(searchInput).not.toBeNull();
    searchInput!.value = 'read';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Reading');
    expect(document.body.textContent).not.toContain('No folders match.');
  });

  it('hides Mark done outside the reading-list tab and shows it on reading list tab', async () => {
    listForFeed.mockResolvedValue([
      { ...baseBookmarks[0]!, readingListAt: 1000 },
      baseBookmarks[1]!,
    ]);
    await import('./main');

    // On discover tab, no Mark done
    const markDoneOnDiscover = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Mark done',
    );
    expect(markDoneOnDiscover).toBeUndefined();

    // On bookmarks tab, no Mark done
    const bookmarksTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Bookmarks',
    );
    bookmarksTab?.click();
    const markDoneOnBookmarks = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Mark done',
    );
    expect(markDoneOnBookmarks).toBeUndefined();

    // On reading list tab, Mark done IS shown
    const readingTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reading list',
    );
    readingTab?.click();
    const markDoneOnReading = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Mark done',
    );
    expect(markDoneOnReading).toBeDefined();
  });

  it('toggles reading-list membership via the star icon', async () => {
    listForFeed.mockResolvedValue(baseBookmarks);
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { ok: true } });
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    await import('./main');

    const bookmarksTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Bookmarks',
    );
    bookmarksTab?.click();

    // Add to reading list
    const star = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title')?.startsWith('Add to reading list'),
    );
    star?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'toggle-reading-list',
      payload: { bookmarkId: 1, add: true },
    });

    // After adding, the star should show "Remove from reading list"
    const removeStar = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title')?.startsWith('Remove from reading list'),
    );
    removeStar?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'toggle-reading-list',
      payload: { bookmarkId: 1, add: false },
    });
  });

  it('dismisses the folder picker via the Cancel button', async () => {
    const folders = [{ id: 'ai', title: 'AI', path: ['AI'] }];
    const sendMessage = vi.fn().mockImplementation((msg: { type: string }) => {
      if (msg.type === 'list-folders') return Promise.resolve({ ok: true, data: folders });
      return Promise.resolve({ ok: true });
    });
    listForFeed.mockResolvedValue(baseBookmarks);
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    baseBookmarks[0]!.chromeId = 'c-1';
    await import('./main');

    const moveIcon = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Move to Chrome folder',
    );
    moveIcon?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Move to Chrome folder');

    const cancelBtn = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    cancelBtn?.click();
    expect(document.body.textContent).not.toContain('Move to Chrome folder');

    // Re-open and dismiss via the backdrop overlay click
    const moveIcon2 = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('title') === 'Move to Chrome folder',
    );
    moveIcon2?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Move to Chrome folder');
    const overlay = document.querySelector<HTMLElement>('.fixed.inset-0.z-50');
    overlay?.click();
    expect(document.body.textContent).not.toContain('Move to Chrome folder');
  });

  it('shows the global empty state on Discover when the store is empty', async () => {
    listForFeed.mockResolvedValue([]);
    await import('./main');
    expect(document.body.textContent).toContain('Your attic is empty');
  });

  it('attaches a cached image blob to the rendered <img> and adds it to the object URL set', async () => {
    const createObjectURL = vi.fn(() => 'blob:cached');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = revokeObjectURL;

    getCachedImage.mockResolvedValue({ blob: new Blob(['x'], { type: 'image/png' }) });
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));

    const img = document.querySelector<HTMLImageElement>('img[alt=""]');
    expect(img?.src).toBe('blob:cached');
  });

  it('falls back to remote imageUrl when no cached blob exists', async () => {
    getCachedImage.mockResolvedValue(undefined);
    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));

    const img = document.querySelector<HTMLImageElement>('img[alt=""]');
    // attachCachedImage marks the urlHash as missing in cache; then the .then() falls back to imageUrl
    expect(img?.src).toContain('a.jpg');
  });

  it('drops a late cached-image resolution when render token has advanced', async () => {
    // Each createObjectURL call returns a fresh, identifiable URL so we can assert which
    // ones get revoked.
    let urlCounter = 0;
    const issuedUrls: string[] = [];
    const createObjectURL = vi.fn(() => {
      const url = `blob:test-${urlCounter++}`;
      issuedUrls.push(url);
      return url;
    });
    const revokedUrls: string[] = [];
    const revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revokeObjectURL;

    // First call resolves slowly so a second render fires before it lands
    let resolveSlow!: (val: { blob: Blob }) => void;
    getCachedImage.mockImplementationOnce(
      () => new Promise((res) => { resolveSlow = res; }),
    );
    getCachedImage.mockResolvedValue({ blob: new Blob(['y'], { type: 'image/png' }) });

    listForFeed.mockResolvedValue(baseBookmarks);
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));

    // Trigger a second render by switching tabs while the first attachCachedImage is still pending
    const bookmarksTab = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Bookmarks',
    );
    bookmarksTab?.click();
    await new Promise((r) => setTimeout(r, 0));

    const createCountBeforeResolve = createObjectURL.mock.calls.length;

    // Resolve the stale call. The token guard returns early once it sees renderToken has
    // advanced — no new URL should be created for the dropped result.
    resolveSlow({ blob: new Blob(['stale'], { type: 'image/png' }) });
    await new Promise((r) => setTimeout(r, 0));

    // No new createObjectURL calls fired in response to the stale resolve.
    expect(createObjectURL.mock.calls.length).toBe(createCountBeforeResolve);

    // None of the issued URLs are present as <img src> in a detached node — every issued
    // URL is either attached to a currently-rendered <img> or has been revoked.
    const currentImgSrcs = new Set(
      [...document.querySelectorAll<HTMLImageElement>('img[alt=""]')].map((img) => img.src),
    );
    for (const url of issuedUrls) {
      const stillUsed = currentImgSrcs.has(url);
      const wasRevoked = revokedUrls.includes(url);
      expect(stillUsed || wasRevoked).toBe(true);
    }
  });

  it('shows a tab-specific empty state on the Reading list tab when no items', async () => {
    listForFeed.mockResolvedValue([
      {
        id: 1,
        url: 'https://example.com/a',
        urlHash: 'a',
        title: 'A bookmark not on the reading list',
        source: 'chrome-bookmarks',
        capturedAt: 1,
        shownCount: 0,
        enrichment: 'ok',
        enrichmentAttempts: 0,
      },
    ] as Bookmark[]);
    await import('./main');

    const readingTab = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reading list',
    );
    readingTab?.click();
    expect(document.body.textContent).toContain('Your reading list is empty');
    // The global "Your attic is empty" must NOT be shown
    expect(document.body.textContent).not.toContain('Your attic is empty');
    // The page-takeover Sync button must NOT be shown either
    const syncButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Sync now',
    );
    expect(syncButton).toBeUndefined();
  });

  it('closes the tag dropdown on outside click', async () => {
    listForFeed.mockResolvedValue([
      {
        id: 1, url: 'https://example.com', urlHash: 'a', title: 'A',
        source: 'manual', capturedAt: 1, shownCount: 0, tags: ['design'],
        enrichment: 'ok', enrichmentAttempts: 0,
      },
    ] as Bookmark[]);
    await import('./main');

    const tagTrigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tags',
    );
    tagTrigger?.click();
    expect(document.querySelector('input[placeholder="Filter tags..."]')).not.toBeNull();

    // Click somewhere outside the menu and the trigger
    await new Promise((r) => setTimeout(r, 0));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('input[placeholder="Filter tags..."]')).toBeNull();
  });
});
