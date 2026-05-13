import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findFolderByTitle, listFolders, topLevelParents } from './folder-picker';
import type { FolderSummary } from '../shared/types';

beforeEach(() => {
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
  } as unknown as typeof chrome;
});

describe('folder-picker', () => {
  it('returns the folders from the background', async () => {
    const folders: FolderSummary[] = [{ id: '1', title: 'AI', path: ['AI'] }];
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true, data: folders });
    expect(await listFolders()).toEqual(folders);
  });

  it('returns an empty array when the background fails', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false, error: 'boom' });
    expect(await listFolders()).toEqual([]);
  });

  it('finds a folder by title case-insensitively', async () => {
    const folders: FolderSummary[] = [
      { id: '1', title: 'AI', path: ['AI'] },
      { id: '2', title: 'Reading', path: ['Reading'] },
    ];
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true, data: folders });
    expect(await findFolderByTitle('ai')).toEqual(folders[0]);
    expect(await findFolderByTitle('  READING  ')).toEqual(folders[1]);
    expect(await findFolderByTitle('missing')).toBeNull();
  });

  it('filters top-level parents by path length', () => {
    const folders: FolderSummary[] = [
      { id: '1', title: 'Bookmarks Bar', path: ['Bookmarks Bar'] },
      { id: '2', title: 'Tech', path: ['Bookmarks Bar', 'Tech'] },
    ];
    expect(topLevelParents(folders)).toEqual([folders[0]]);
  });
});
