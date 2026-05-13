import { describe, expect, it } from 'vitest';
import type { Bookmark } from '../shared/types';
import { availableSources, availableTags, filterBookmarks, parseTags } from './library';

const base: Bookmark = {
  id: 1,
  url: 'https://example.com/article',
  urlHash: 'a',
  title: 'A deep Flutter article',
  description: 'Responsive UI and mobile layout notes',
  siteName: 'Example',
  source: 'chrome-bookmarks',
  capturedAt: 1,
  shownCount: 0,
  enrichment: 'ok',
  enrichmentAttempts: 0,
  tags: ['flutter', 'mobile'],
};

describe('filterBookmarks', () => {
  it('searches title, description, site name, URL, and snapshot text', () => {
    const rows: Bookmark[] = [
      base,
      {
        ...base,
        id: 2,
        urlHash: 'b',
        title: 'Cooking',
        description: 'Kitchen notes',
        snapshotText: 'pasta dough',
        tags: [],
      },
    ];

    expect(filterBookmarks(rows, { query: 'pasta' }).map((row) => row.urlHash)).toEqual(['b']);
    expect(filterBookmarks(rows, { query: 'responsive' }).map((row) => row.urlHash)).toEqual(['a']);
  });

  it('filters by source, tag, and consumed state', () => {
    const rows: Bookmark[] = [
      base,
      { ...base, id: 2, urlHash: 'b', source: 'site:youtube', consumedAt: 2, tags: ['video'] },
    ];

    expect(filterBookmarks(rows, { source: 'site:youtube' }).map((row) => row.urlHash)).toEqual([
      'b',
    ]);
    expect(filterBookmarks(rows, { tag: 'flutter' }).map((row) => row.urlHash)).toEqual(['a']);
    expect(filterBookmarks(rows, { consumed: 'active' }).map((row) => row.urlHash)).toEqual(['a']);
    expect(filterBookmarks(rows, { consumed: 'consumed' }).map((row) => row.urlHash)).toEqual([
      'b',
    ]);
  });

  it('matches site sources against chrome bookmark hosts too', () => {
    const bookmarks: Bookmark[] = [
      {
        ...base,
        url: 'https://youtube.com/watch?v=a',
        urlHash: 'a',
        title: 'Captured via extension',
        source: 'site:youtube',
        capturedAt: 1,
      },
      {
        ...base,
        url: 'https://youtube.com/watch?v=b',
        urlHash: 'b',
        title: 'Chrome bookmark youtube link',
        source: 'chrome-bookmarks',
        capturedAt: 2,
      },
      {
        ...base,
        url: 'https://example.com',
        urlHash: 'c',
        title: 'Unrelated',
        source: 'chrome-bookmarks',
        capturedAt: 3,
      },
      {
        ...base,
        url: 'not-a-valid-url',
        urlHash: 'd',
        title: 'Bad URL',
        source: 'chrome-bookmarks',
        capturedAt: 4,
      },
    ];
    const out = filterBookmarks(bookmarks, { source: 'site:youtube' });
    expect(out.map((b) => b.urlHash).sort()).toEqual(['a', 'b']);
  });

  it('filters by reading-list membership', () => {
    const a: Bookmark = {
      url: 'https://a',
      urlHash: 'a',
      title: 'A',
      source: 'manual',
      capturedAt: 1,
      shownCount: 0,
      readingListAt: 100,
      enrichment: 'ok',
      enrichmentAttempts: 0,
    };
    const b: Bookmark = {
      url: 'https://b',
      urlHash: 'b',
      title: 'B',
      source: 'chrome-bookmarks',
      capturedAt: 2,
      shownCount: 0,
      enrichment: 'ok',
      enrichmentAttempts: 0,
    };
    expect(filterBookmarks([a, b], { readingList: 'in' })).toEqual([a]);
    expect(filterBookmarks([a, b], { readingList: 'out' })).toEqual([b]);
    expect(filterBookmarks([a, b], { readingList: 'all' }).length).toBe(2);
  });
});

describe('library facets', () => {
  it('returns sorted sources and tags', () => {
    const rows: Bookmark[] = [
      base,
      { ...base, id: 2, urlHash: 'b', source: 'site:youtube', tags: ['video', 'flutter'] },
    ];

    expect(availableSources(rows)).toEqual(['chrome-bookmarks', 'site:youtube']);
    expect(availableTags(rows)).toEqual(['flutter', 'mobile', 'video']);
  });

  it('parses comma-separated tags into a normalized unique list', () => {
    expect(parseTags(' Flutter, mobile, flutter ,,  Web UI ')).toEqual([
      'flutter',
      'mobile',
      'web ui',
    ]);
  });
});
