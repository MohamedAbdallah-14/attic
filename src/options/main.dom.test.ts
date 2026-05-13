import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  document.body.innerHTML = '<div id="options-root"></div>';
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  });
  const chromeStorageStore = new Map<string, unknown>();
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn().mockImplementation((msg: { type: string }) => {
        if (msg.type === 'popup-stats')
          return Promise.resolve({ ok: true, data: { bookmarks: 5, reading: 2, done: 1 } });
        if (msg.type === 'enrichment-status')
          return Promise.resolve({ ok: true, data: { pending: 0, ok: 5, failed: 0 } });
        if (msg.type === 'image-cache-stats')
          return Promise.resolve({ ok: true, data: { count: 3, bytes: 24576 } });
        if (msg.type === 'local-activity')
          return Promise.resolve({
            ok: true,
            data: { capturesWeek: 4, doneWeek: 1, shownTotal: 21 },
          });
        if (msg.type === 'export-data')
          return Promise.resolve({ ok: true, data: { bookmarks: [], exportedAt: 1 } });
        if (msg.type === 'resync-bookmarks')
          return Promise.resolve({ ok: true, data: { inserted: 0 } });
        if (msg.type === 'rerun-failed-enrichment')
          return Promise.resolve({ ok: true, data: { reset: 0 } });
        if (msg.type === 'clear-all')
          return Promise.resolve({ ok: true, data: { ok: true } });
        return Promise.resolve({ ok: true });
      }),
      openOptionsPage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn().mockImplementation((key: string) =>
          Promise.resolve({ [key]: chromeStorageStore.get(key) }),
        ),
        set: vi.fn().mockImplementation((obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) chromeStorageStore.set(k, v);
          return Promise.resolve();
        }),
      },
    },
  } as unknown as typeof chrome;
  vi.resetModules();
});

describe('Attic options page', () => {
  it('renders sections and live counts', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Theme');
    expect(document.body.textContent).toContain('Capture defaults');
    expect(document.body.textContent).toContain('Data usage');
    expect(document.body.textContent).toContain('5'); // bookmarks
    expect(document.body.textContent).toContain('24'); // KB-ish from 24576 bytes = 24.0 KB
  });

  it('persists capture mode change to both localStorage and chrome.storage', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    const reading = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reading list',
    );
    reading?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem('attic-capture-mode')).toBe('reading');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ atticCaptureMode: 'reading' });
  });

  it('hydrates capture mode from chrome.storage.local on boot when it diverges from localStorage', async () => {
    // Seed chrome.storage with a value localStorage does not have.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'atticCaptureMode' ? Promise.resolve({ atticCaptureMode: 'bookmarks' }) : Promise.resolve({}),
    );

    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // After hydration the localStorage mirror should match the chrome.storage value
    expect(localStorage.getItem('attic-capture-mode')).toBe('bookmarks');
  });

  it('shows a confirm before clearing all data', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    const clear = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Delete all'),
    );
    clear?.click();
    expect(document.body.textContent).toContain('This wipes every saved bookmark');
  });

  it('renders all settings sections', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Attic settings');
    expect(document.body.textContent).toContain('Delete preference');
    expect(document.body.textContent).toContain('Local activity');
    expect(document.body.textContent).toContain('Manage data');
    expect(document.body.textContent).toContain('Danger zone');
  });

  it('persists theme change to localStorage', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    const darkBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Dark',
    );
    darkBtn?.click();
    expect(localStorage.getItem('attic-theme-preference')).toBe('dark');
  });

  it('persists delete scope change to localStorage', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    const atticOnly = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Attic only',
    );
    atticOnly?.click();
    expect(localStorage.getItem('attic-delete-scope')).toBe('attic');
  });

  it('cancels clear confirmation', async () => {
    await import('./main');
    await new Promise((r) => setTimeout(r, 0));
    const clear = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Delete all'),
    );
    clear?.click();
    expect(document.body.textContent).toContain('This wipes every saved bookmark');
    const cancel = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    cancel?.click();
    expect(document.body.textContent).not.toContain('This wipes every saved bookmark');
  });

  it('runs Re-sync, Re-run failed enrichment, Export, and confirmed Delete-all actions', async () => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn(() => undefined);
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = origCreate(tag) as HTMLElement;
      if (tag === 'a') (node as HTMLAnchorElement).click = clickSpy;
      return node;
    });

    await import('./main');
    await new Promise((r) => setTimeout(r, 0));

    const resync = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Re-sync'),
    );
    resync?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'resync-bookmarks' });

    const rerun = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Re-run failed'),
    );
    rerun?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'rerun-failed-enrichment' });

    const exportBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Export'),
    );
    exportBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'export-data' });
    expect(clickSpy).toHaveBeenCalled();

    const clear = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Delete all'),
    );
    clear?.click();
    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete everything',
    );
    confirm?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'clear-all' });
  });

  it('shows error toasts when background actions fail', async () => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((msg: any) => {
      if (msg.type === 'popup-stats')
        return Promise.resolve({ ok: true, data: { bookmarks: 0, reading: 0, done: 0 } });
      if (msg.type === 'enrichment-status')
        return Promise.resolve({ ok: true, data: { pending: 0, ok: 0, failed: 0 } });
      if (msg.type === 'image-cache-stats')
        return Promise.resolve({ ok: true, data: { count: 0, bytes: 0 } });
      if (msg.type === 'local-activity')
        return Promise.resolve({ ok: true, data: { capturesWeek: 0, doneWeek: 0, shownTotal: 0 } });
      return Promise.resolve({ ok: false, error: 'boom' });
    });

    await import('./main');
    await new Promise((r) => setTimeout(r, 0));

    const resync = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Re-sync'),
    );
    resync?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Sync failed');

    const rerun = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Re-run failed'),
    );
    rerun?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Failed to reset enrichment');

    const exportBtn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Export'),
    );
    exportBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Export failed');

    const clear = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Delete all'),
    );
    clear?.click();
    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete everything',
    );
    confirm?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('Clear failed');
  });
});
