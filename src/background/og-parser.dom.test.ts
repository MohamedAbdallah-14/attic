import { describe, expect, it } from 'vitest';
import { parseMeta } from './og-parser';

const baseUrl = 'https://example.com/article';

describe('parseMeta', () => {
  it('extracts og:title, og:description, og:image', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Hello">
        <meta property="og:description" content="Desc">
        <meta property="og:image" content="https://cdn.example.com/img.jpg">
      </head><body></body></html>`;

    const meta = parseMeta(html, baseUrl);

    expect(meta.title).toBe('Hello');
    expect(meta.description).toBe('Desc');
    expect(meta.imageUrl).toBe('https://cdn.example.com/img.jpg');
  });

  it('falls back to twitter: tags', () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="TW Title">
        <meta name="twitter:image" content="/img.jpg">
      </head><body></body></html>`;

    const meta = parseMeta(html, baseUrl);

    expect(meta.title).toBe('TW Title');
    expect(meta.imageUrl).toBe('https://example.com/img.jpg');
  });

  it('falls back to <title> and <link rel="icon">', () => {
    const html = `
      <html><head>
        <title>Plain title</title>
        <link rel="icon" href="/favicon.png">
      </head><body></body></html>`;

    const meta = parseMeta(html, baseUrl);

    expect(meta.title).toBe('Plain title');
    expect(meta.faviconUrl).toBe('https://example.com/favicon.png');
  });

  it('resolves protocol-relative URLs', () => {
    const html =
      '<html><head><meta property="og:image" content="//cdn.example.com/img.jpg"></head></html>';

    const meta = parseMeta(html, baseUrl);

    expect(meta.imageUrl).toBe('https://cdn.example.com/img.jpg');
  });

  it('returns empty object on empty HTML', () => {
    expect(parseMeta('', baseUrl)).toEqual({});
  });
});
