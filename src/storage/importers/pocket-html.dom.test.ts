import { describe, expect, it } from 'vitest';
import { parsePocketHtml } from './pocket-html';

const sample = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<TITLE>Pocket Export</TITLE>
<H1>Pocket Export</H1>
<UL>
  <LI><A HREF="https://example.com/a" ADD_DATE="1700000000" TAGS="ai,reading">Example A</A>
  <LI><A HREF="https://example.com/b" ADD_DATE="1700001000">Example B</A>
  <LI><A HREF="javascript:alert(1)">Bad</A>
</UL>`;

describe('parsePocketHtml', () => {
  it('returns one entry per valid anchor', () => {
    const out = parsePocketHtml(sample);

    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ url: 'https://example.com/a', title: 'Example A' });
    expect(out[1]).toMatchObject({ url: 'https://example.com/b', title: 'Example B' });
  });

  it('uses ADD_DATE as capturedAt in milliseconds', () => {
    const out = parsePocketHtml(sample);
    expect(out[0]?.capturedAt).toBe(1_700_000_000 * 1000);
  });

  it('imports Pocket tags as normalized local tags', () => {
    const out = parsePocketHtml(sample);
    expect(out[0]?.tags).toEqual(['ai', 'reading']);
  });

  it('skips non-http URLs', () => {
    const out = parsePocketHtml(sample);
    expect(out.every((entry) => entry.url.startsWith('http'))).toBe(true);
  });

  it('returns [] on empty input', () => {
    expect(parsePocketHtml('')).toEqual([]);
  });
});
