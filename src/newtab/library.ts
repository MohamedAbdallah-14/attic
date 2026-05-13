import type { Bookmark, BookmarkSource } from '../shared/types';

export type ConsumedFilter = 'all' | 'active' | 'consumed';

export interface LibraryFilters {
  query?: string;
  source?: BookmarkSource | 'all';
  tag?: string | 'all';
  consumed?: ConsumedFilter;
  readingList?: 'all' | 'in' | 'out';
}

export function filterBookmarks(bookmarks: Bookmark[], filters: LibraryFilters): Bookmark[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  const source = filters.source ?? 'all';
  const tag = filters.tag ?? 'all';
  const consumed = filters.consumed ?? 'all';
  const readingList = filters.readingList ?? 'all';

  const platform = typeof source === 'string' && source.startsWith('site:') ? source.slice(5) : null;
  return bookmarks.filter((bookmark) => {
    if (readingList === 'in' && !bookmark.readingListAt) return false;
    if (readingList === 'out' && bookmark.readingListAt) return false;
    if (source !== 'all') {
      if (platform) {
        if (bookmark.source === source) {
          // matches the extension-captured row
        } else if (urlHost(bookmark.url).includes(platform)) {
          // matches a Chrome-bookmarked URL on the same platform
        } else {
          return false;
        }
      } else if (bookmark.source !== source) {
        return false;
      }
    }
    if (tag !== 'all' && !bookmark.tags?.includes(tag)) return false;
    if (consumed === 'active' && bookmark.consumedAt) return false;
    if (consumed === 'consumed' && !bookmark.consumedAt) return false;
    if (!query) return true;

    return searchText(bookmark).includes(query);
  });
}

export function availableSources(bookmarks: Bookmark[]): BookmarkSource[] {
  return [...new Set(bookmarks.map((bookmark) => bookmark.source))].sort();
}

export function availableTags(bookmarks: Bookmark[]): string[] {
  return [...new Set(bookmarks.flatMap((bookmark) => bookmark.tags ?? []))].sort();
}

export function tagCounts(bookmarks: Bookmark[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    for (const tag of bookmark.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function searchText(bookmark: Bookmark): string {
  return [
    bookmark.title,
    bookmark.description,
    bookmark.siteName,
    bookmark.url,
    bookmark.snapshotText,
    ...(bookmark.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function urlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
