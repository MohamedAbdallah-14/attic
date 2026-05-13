import { beforeEach, describe, expect, it, vi } from 'vitest';

const initialSync = vi.fn();
const kickEnrichment = vi.fn();
const maybeSyncBookmarks = vi.fn();
const registerBookmarkListeners = vi.fn();
const registerEnrichment = vi.fn();
const registerContextMenus = vi.fn();
const registerHandlers = vi.fn();
const startMessaging = vi.fn();

vi.mock('./bookmarks-sync', () => ({ initialSync, registerBookmarkListeners }));
vi.mock('./enrichment', () => ({ kickEnrichment, registerEnrichment }));
vi.mock('./handlers', () => ({ maybeSyncBookmarks, registerContextMenus, registerHandlers }));
vi.mock('./messaging', () => ({ startMessaging }));

describe('background entrypoint', () => {
  let installHandler: ((details: chrome.runtime.InstalledDetails) => Promise<void>) | undefined;
  let startupHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installHandler = undefined;
    startupHandler = undefined;
    initialSync.mockResolvedValue({ inserted: 2 });
    kickEnrichment.mockResolvedValue(undefined);
    maybeSyncBookmarks.mockResolvedValue({ synced: true, inserted: 1, tagged: 1 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    globalThis.chrome = {
      runtime: {
        onInstalled: {
          addListener: vi.fn((handler) => {
            installHandler = handler;
          }),
        },
        onStartup: {
          addListener: vi.fn((handler) => {
            startupHandler = handler;
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('registers background services and performs install sync', async () => {
    await import('./index');

    expect(registerBookmarkListeners).toHaveBeenCalled();
    expect(startMessaging).toHaveBeenCalled();
    expect(registerHandlers).toHaveBeenCalled();
    expect(registerContextMenus).toHaveBeenCalled();
    expect(registerEnrichment).toHaveBeenCalled();

    await installHandler?.({ reason: 'install' } as chrome.runtime.InstalledDetails);
    expect(initialSync).toHaveBeenCalled();
    expect(kickEnrichment).toHaveBeenCalled();
  });

  it('skips initial sync on updates and triggers a maintenance sync on startup', async () => {
    await import('./index');

    await installHandler?.({ reason: 'update' } as chrome.runtime.InstalledDetails);
    startupHandler?.();

    expect(initialSync).not.toHaveBeenCalled();
    expect(kickEnrichment).toHaveBeenCalled();
    expect(maybeSyncBookmarks).toHaveBeenCalled();
  });
});
