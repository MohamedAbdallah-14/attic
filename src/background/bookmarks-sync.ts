import { deriveFolderTags } from '../shared/auto-tags';
import { hashUrl, isHttpUrl } from '../shared/url';
import { markRemoved, upsertByHash } from '../storage/bookmarks';

interface FlatNode {
  node: chrome.bookmarks.BookmarkTreeNode;
  folderPath: string[];
}

function flatten(roots: chrome.bookmarks.BookmarkTreeNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const stack: Array<{ node: chrome.bookmarks.BookmarkTreeNode; folderPath: string[] }> = [];

  for (const root of roots) {
    if (root.children) {
      for (const child of root.children) stack.push({ node: child, folderPath: [] });
    }
  }

  while (stack.length) {
    const current = stack.pop()!;
    const node = current.node;
    if (node.url && isHttpUrl(node.url)) {
      out.push({ node, folderPath: current.folderPath });
      continue;
    }
    if (node.children) {
      const nextPath = node.title ? [...current.folderPath, node.title] : current.folderPath;
      for (const child of node.children) stack.push({ node: child, folderPath: nextPath });
    }
  }

  return out;
}

async function syncChromeBookmarks(opts: { touchExisting: boolean }): Promise<{ inserted: number }> {
  const tree = await chrome.bookmarks.getTree();
  const flat = flatten(tree);
  let inserted = 0;

  for (const { node, folderPath } of flat) {
    const folderTags = deriveFolderTags(folderPath);
    await upsertByHash({
      url: node.url!,
      title: node.title || undefined,
      source: 'chrome-bookmarks',
      capturedAt: node.dateAdded ?? Date.now(),
      tags: folderTags.length ? folderTags : undefined,
      chromeId: node.id,
      ...(opts.touchExisting ? {} : { touchExisting: false }),
    });
    inserted += 1;
  }

  return { inserted };
}

export function initialSync(): Promise<{ inserted: number }> {
  return syncChromeBookmarks({ touchExisting: true });
}

export function routineSync(): Promise<{ inserted: number }> {
  return syncChromeBookmarks({ touchExisting: false });
}

async function folderPathForParent(parentId: string | undefined): Promise<string[]> {
  if (!parentId) return [];
  const path: string[] = [];
  let cursor: string | undefined = parentId;
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const nodes: chrome.bookmarks.BookmarkTreeNode[] | undefined = await chrome.bookmarks
      .get(cursor)
      .catch(() => undefined);
    const node: chrome.bookmarks.BookmarkTreeNode | undefined = nodes?.[0];
    if (!node) break;
    if (node.title) path.unshift(node.title);
    cursor = node.parentId;
  }

  if (path.length > 0) path.shift();
  return path;
}

export function registerBookmarkListeners(): void {
  chrome.bookmarks.onCreated.addListener(async (_id, node) => {
    if (!node.url || !isHttpUrl(node.url)) return;

    const folderPath = await folderPathForParent(node.parentId);
    const folderTags = deriveFolderTags(folderPath);

    await upsertByHash({
      url: node.url,
      title: node.title || undefined,
      source: 'chrome-bookmarks',
      capturedAt: node.dateAdded ?? Date.now(),
      tags: folderTags.length ? folderTags : undefined,
      chromeId: node.id,
    });
  });

  chrome.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    if (!changeInfo.url || !isHttpUrl(changeInfo.url)) return;

    await upsertByHash({
      url: changeInfo.url,
      title: changeInfo.title || undefined,
      source: 'chrome-bookmarks',
      chromeId: id,
    });
  });

  chrome.bookmarks.onRemoved.addListener(async (_id, removeInfo) => {
    const url = removeInfo.node.url;
    if (!url || !isHttpUrl(url)) return;

    const urlHash = await hashUrl(url);
    await markRemoved(urlHash);
  });

  chrome.bookmarks.onMoved.addListener(async (id) => {
    const nodes = await chrome.bookmarks.get(id).catch(() => undefined);
    const node = nodes?.[0];
    if (!node?.url || !isHttpUrl(node.url)) return;

    const folderPath = await folderPathForParent(node.parentId);
    const folderTags = deriveFolderTags(folderPath);

    await upsertByHash({
      url: node.url,
      title: node.title || undefined,
      source: 'chrome-bookmarks',
      tags: folderTags.length ? folderTags : undefined,
      touchExisting: false,
      chromeId: id,
    });
  });
}
