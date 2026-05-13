import { describe, expect, it } from 'vitest';
import type { Bookmark } from '../shared/types';
import { pickNext, weightFor } from './feed';

const base: Bookmark = {
  url: 'https://x.test',
  urlHash: 'a',
  title: 't',
  source: 'manual',
  capturedAt: Date.now(),
  shownCount: 0,
  enrichment: 'ok',
  enrichmentAttempts: 0,
};

describe('weightFor', () => {
  it('removed -> 0', () => {
    expect(weightFor({ ...base, removed: true }, Date.now())).toBe(0);
  });

  it('shownCount=0, captured today -> ~2', () => {
    const weight = weightFor(base, base.capturedAt);
    expect(weight).toBeGreaterThan(1.99);
    expect(weight).toBeLessThan(2.01);
  });

  it('shownCount=99 -> tiny weight', () => {
    const weight = weightFor({ ...base, shownCount: 99 }, base.capturedAt);
    expect(weight).toBeLessThan(0.3);
  });

  it('drops consumed bookmarks out of the random feed', () => {
    const bookmark: Bookmark = {
      url: 'https://done.example',
      urlHash: 'h',
      title: 'Done',
      source: 'manual',
      capturedAt: 0,
      shownCount: 0,
      consumedAt: 1,
      enrichment: 'ok',
      enrichmentAttempts: 0,
    };
    expect(weightFor(bookmark, 1)).toBe(0);
    expect(pickNext([bookmark], 1)).toBeNull();
  });

  it('age 30+ days -> recency factor 1', () => {
    const old = { ...base, capturedAt: Date.now() - 31 * 86_400_000 };
    const weight = weightFor(old, Date.now());
    expect(weight).toBeCloseTo(1, 5);
  });
});

describe('pickNext', () => {
  it('returns a member of the input set', () => {
    const items = [
      { ...base, urlHash: 'a' },
      { ...base, urlHash: 'b' },
      { ...base, urlHash: 'c' },
    ];

    const got = pickNext(items, Date.now());

    expect(items.some((item) => item.urlHash === got?.urlHash)).toBe(true);
  });

  it('returns null on empty input', () => {
    expect(pickNext([], Date.now())).toBeNull();
  });

  it('never picks a zero-weight item', () => {
    const items = [
      { ...base, urlHash: 'a', removed: true },
      { ...base, urlHash: 'b' },
    ];

    for (let i = 0; i < 50; i += 1) {
      const got = pickNext(items, Date.now());
      expect(got?.urlHash).toBe('b');
    }
  });
});
