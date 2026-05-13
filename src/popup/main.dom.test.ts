import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('popup UI', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="popup-root"></div>';
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'popup-stats') {
            return Promise.resolve({ ok: true, data: { bookmarks: 5, reading: 3, done: 1 } });
          }
          return Promise.resolve({ ok: true, data: { inserted: 2 } });
        }),
        openOptionsPage: vi.fn(),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { url: 'https://active.example', title: 'Active tab', favIconUrl: 'https://active.example/favicon.ico' },
        ]),
        create: vi.fn(),
      },
    } as unknown as typeof chrome;
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  });

  function openMore(): void {
    const toggle = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('More actions'),
    );
    toggle?.click();
  }

  it('saves the current tab to the reading list by default', async () => {
    await import('./main');
    await settle();
    await settle();

    const saveBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save to Reading list'),
    );
    expect(saveBtn).toBeTruthy();
    saveBtn?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'capture',
      payload: {
        url: 'https://active.example',
        title: 'Active tab',
        source: 'manual',
        tags: undefined,
        destination: 'reading',
      },
    });
  });

  it('saves with bookmarks destination when Bookmarks pill is selected', async () => {
    await import('./main');
    await settle();
    await settle();

    const bookmarksBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim() === '📁 Bookmarks',
    );
    bookmarksBtn?.click();
    await settle();

    const saveBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save to Bookmarks'),
    );
    expect(saveBtn).toBeTruthy();
    saveBtn?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'capture',
      payload: {
        url: 'https://active.example',
        title: 'Active tab',
        source: 'manual',
        tags: undefined,
        destination: 'bookmarks',
      },
    });
  });

  it('shows stats tiles with mocked numbers', async () => {
    await import('./main');
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'popup-stats' });
    expect(document.body.textContent).toContain('Bookmarks');
    expect(document.body.textContent).toContain('Reading');
    expect(document.body.textContent).toContain('Done');
  });

  it('admin actions (re-sync, re-run, import, clear) are inside the More section', async () => {
    await import('./main');
    await settle();
    await settle();

    expect(document.body.textContent).not.toContain('Re-sync');
    expect(document.body.textContent).not.toContain('Re-run');

    openMore();

    expect(document.body.textContent).toContain('Re-sync');
    expect(document.body.textContent).toContain('Re-run failed enrichment');
    expect(document.body.textContent).toContain('Import Pocket');
    expect(document.body.textContent).toContain('Clear all local data');
  });

  it('re-sync Chrome bookmarks triggers resync-bookmarks message', async () => {
    await import('./main');
    await settle();
    await settle();

    openMore();

    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, data: { inserted: 10 } });
    const resync = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Re-sync Chrome bookmarks'),
    );
    resync?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'resync-bookmarks' });
  });

  it('re-run failed enrichment triggers rerun-failed-enrichment message', async () => {
    await import('./main');
    await settle();
    await settle();

    openMore();

    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, data: { reset: 4 } });
    const rerun = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Re-run failed enrichment'),
    );
    rerun?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'rerun-failed-enrichment' });
  });

  it('Clear all local data shows a confirm dialog before firing', async () => {
    await import('./main');
    await settle();
    await settle();

    openMore();

    const clear = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Clear all local data'),
    );
    clear?.click();

    expect(document.body.textContent).toContain('Delete all local bookmarks data?');
    expect(document.body.textContent).toContain('Delete everything');

    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ ok: true, data: {} });
    const confirmBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete everything'),
    );
    confirmBtn?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'clear-all' });
  });

  it('Clear confirm dialog can be cancelled without firing clear-all', async () => {
    await import('./main');
    await settle();
    await settle();

    openMore();

    const clear = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Clear all local data'),
    );
    clear?.click();

    expect(document.body.textContent).toContain('Delete all local bookmarks data?');

    const cancelBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Cancel'),
    );
    cancelBtn?.click();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'clear-all' });
  });

  it('imports Pocket HTML via the file input inside More section', async () => {
    await import('./main');
    await settle();
    await settle();

    openMore();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(
      ['<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://read.example" TAGS="ai,reading">Read</A>'],
      'pocket.html',
      { type: 'text/html' },
    );
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue(
        '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://read.example" TAGS="ai,reading">Read</A>',
      ),
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'import-pocket',
      payload: {
        rows: [
          {
            url: 'https://read.example',
            title: 'Read',
            tags: ['ai', 'reading'],
          },
        ],
      },
    });
  });

  it('captures typed tags from the tags input and includes them in the save payload', async () => {
    await import('./main');
    await settle();
    await settle();

    const tagsInput = document.querySelector<HTMLInputElement>('input[type="text"]');
    expect(tagsInput).toBeTruthy();
    tagsInput!.value = 'ai, reading';
    tagsInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const saveBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save to Reading list'),
    );
    saveBtn?.click();
    await settle();
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'capture',
      payload: {
        url: 'https://active.example',
        title: 'Active tab',
        source: 'manual',
        tags: ['ai', 'reading'],
        destination: 'reading',
      },
    });
  });

  it('reports Pocket import errors without crashing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((msg: any) => {
      if (msg?.type === 'popup-stats') return Promise.resolve({ ok: true, data: { bookmarks: 0, reading: 0, done: 0 } });
      if (msg?.type === 'import-pocket') return Promise.resolve({ ok: false, error: 'bad import' });
      return Promise.resolve({ ok: true, data: {} });
    });
    await import('./main');
    await settle();
    await settle();

    openMore();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['broken'], 'pocket.html', { type: 'text/html' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('broken') });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await settle();

    expect(document.getElementById('popup-root')).toBeTruthy();
  });

  it('serializes non-Error failures in resync without crashing', async () => {
    await import('./main');
    await settle();
    await settle();

    openMore();

    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => Promise.reject('offline'));
    const resync = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Re-sync'),
    );
    resync?.click();
    await settle();
    await settle();

    expect(document.getElementById('popup-root')).toBeTruthy();
  });
});
