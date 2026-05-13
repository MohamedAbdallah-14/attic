export interface FolderEntry {
  id: string;
  title: string;
  path: string[];
  parentId?: string;
}

function walk(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[],
  parentId: string | undefined,
  out: FolderEntry[],
): void {
  for (const node of nodes) {
    if (node.url) continue;
    const path = node.title ? [...parentPath, node.title] : parentPath;
    if (node.title) out.push({ id: node.id, title: node.title, path, parentId });
    if (node.children) walk(node.children, path, node.id, out);
  }
}

export async function listAllFolders(): Promise<FolderEntry[]> {
  const tree = await chrome.bookmarks.getTree();
  const out: FolderEntry[] = [];
  for (const root of tree) {
    if (root.children) walk(root.children, [], root.id, out);
  }
  return out;
}

export async function findFolderByName(name: string): Promise<FolderEntry | undefined> {
  const folders = await listAllFolders();
  const lower = name.trim().toLowerCase();
  return folders.find((folder) => folder.title.toLowerCase() === lower);
}

export async function createFolder(
  title: string,
  parentId: string,
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.create({ parentId, title });
}

export async function moveBookmarkToFolder(
  bookmarkChromeId: string,
  folderId: string,
): Promise<void> {
  await chrome.bookmarks.move(bookmarkChromeId, { parentId: folderId });
}

export async function removeChromeBookmark(chromeId: string): Promise<void> {
  await chrome.bookmarks.remove(chromeId);
}
