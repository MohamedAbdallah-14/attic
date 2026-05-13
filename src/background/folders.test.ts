import { beforeEach, describe, expect, it, vi } from 'vitest';

const tree = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: 'ai', title: 'AI' },
          { id: 'reading', title: 'Reading', children: [{ id: 'tech', title: 'Tech' }] },
        ],
      },
      { id: '2', title: 'Other Bookmarks' },
    ],
  },
];

const getTree = vi.fn().mockResolvedValue(tree);
const move = vi.fn().mockResolvedValue(undefined);
const create = vi.fn().mockResolvedValue({ id: 'new-folder', title: 'NewOne' });
const remove = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  globalThis.chrome = {
    bookmarks: { getTree, move, create, remove },
  } as unknown as typeof chrome;
});

describe('folders', () => {
  it('lists every folder with its full title path', async () => {
    const { listAllFolders } = await import('./folders');
    const folders = await listAllFolders();
    const titles = folders.map((f) => f.path.join(' / '));
    expect(titles).toContain('Bookmarks Bar / AI');
    expect(titles).toContain('Bookmarks Bar / Reading / Tech');
    expect(titles).toContain('Other Bookmarks');
  });

  it('finds a folder case-insensitively by leaf name', async () => {
    const { findFolderByName } = await import('./folders');
    expect((await findFolderByName('ai'))?.id).toBe('ai');
    expect((await findFolderByName('AI'))?.id).toBe('ai');
    expect(await findFolderByName('unknown')).toBeUndefined();
  });

  it('creates a folder under the given parent and returns it', async () => {
    const { createFolder } = await import('./folders');
    const folder = await createFolder('NewOne', '1');
    expect(create).toHaveBeenCalledWith({ parentId: '1', title: 'NewOne' });
    expect(folder.id).toBe('new-folder');
  });

  it('moves a bookmark into a folder', async () => {
    const { moveBookmarkToFolder } = await import('./folders');
    await moveBookmarkToFolder('node-7', 'ai');
    expect(move).toHaveBeenCalledWith('node-7', { parentId: 'ai' });
  });

  it('removes a Chrome bookmark by id', async () => {
    const { removeChromeBookmark } = await import('./folders');
    await removeChromeBookmark('node-7');
    expect(remove).toHaveBeenCalledWith('node-7');
  });

  it('skips bookmark leaf nodes (nodes with a url) when walking', async () => {
    const treeWithLeaves = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: 'Bookmarks Bar',
            children: [
              { id: 'a', title: 'Article', url: 'https://example.com' },
              { id: 'f', title: 'Folder' },
            ],
          },
        ],
      },
    ];
    getTree.mockResolvedValueOnce(treeWithLeaves);
    const { listAllFolders } = await import('./folders');
    const folders = await listAllFolders();
    expect(folders.map((f) => f.id)).not.toContain('a');
    expect(folders.map((f) => f.id)).toContain('f');
  });

  it('handles root nodes with empty titles without adding empty path segments', async () => {
    const treeWithEmptyRoot = [
      {
        id: '0',
        title: '',
        children: [{ id: '1', title: 'Bar' }],
      },
    ];
    getTree.mockResolvedValueOnce(treeWithEmptyRoot);
    const { listAllFolders } = await import('./folders');
    const folders = await listAllFolders();
    expect(folders[0]?.path).toEqual(['Bar']);
  });
});
