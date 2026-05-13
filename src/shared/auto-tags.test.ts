import { describe, expect, it } from 'vitest';
import { deriveAutoTags, deriveFolderTags, mergeTags } from './auto-tags';

describe('auto tags', () => {
  it('adds a normalized website tag and curated category tags', () => {
    expect(deriveAutoTags('https://github.com/HeyPuter/puter')).toEqual(['code', 'github']);
    expect(deriveAutoTags('https://www.youtube.com/watch?v=abc')).toEqual(['video', 'youtube']);
    expect(deriveAutoTags('https://nesslabs.com/slow-productivity')).toEqual([
      'nesslabs',
      'reading',
    ]);
    expect(deriveAutoTags('https://subdomain.medium.com/story')).toEqual(['medium', 'reading']);
  });

  it('merges existing tags without duplicates', () => {
    expect(mergeTags(['reading', 'ai'], ['github', 'code', 'ai'])).toEqual([
      'ai',
      'code',
      'github',
      'reading',
    ]);
  });

  it('ignores URLs that cannot produce a website tag', () => {
    expect(deriveAutoTags('nota url')).toEqual([]);
    expect(mergeTags(undefined, ['  Hello World  ', 'hello-world'])).toEqual(['hello-world']);
  });

  it('derives folder tags, skipping Chrome system folders and normalizing names', () => {
    expect(deriveFolderTags(['Bookmarks Bar', 'Reading', 'Tech'])).toEqual(['reading', 'tech']);
    expect(deriveFolderTags(['Other Bookmarks'])).toEqual([]);
    expect(deriveFolderTags([])).toEqual([]);
    expect(deriveFolderTags(['  Work / Projects  '])).toEqual(['work-projects']);
    expect(deriveFolderTags(['Tech', 'Tech'])).toEqual(['tech']);
    expect(deriveFolderTags(['***'])).toEqual([]);
  });

  it('handles single-label hostnames and parser exceptions', () => {
    expect(deriveAutoTags('http://localhost/path')).toEqual(['localhost']);
    expect(deriveAutoTags('://broken url with spaces')).toEqual([]);
  });
});
