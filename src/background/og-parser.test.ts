import { describe, expect, it } from 'vitest';
import { parseMeta } from './og-parser';

describe('parseMeta service-worker compatibility', () => {
  it('extracts metadata without DOMParser', () => {
    const html = `
      <html><head>
        <title>Fallback &amp; Title</title>
        <meta property="og:title" content="OG &quot;Title&quot;">
        <meta name="description" content="Plain description">
        <meta name="twitter:image" content="/cover.png">
        <link rel="shortcut icon" href="/favicon.ico">
      </head><body></body></html>`;

    const meta = parseMeta(html, 'https://example.com/article');

    expect(meta).toMatchObject({
      title: 'OG "Title"',
      description: 'Plain description',
      imageUrl: 'https://example.com/cover.png',
      faviconUrl: 'https://example.com/favicon.ico',
    });
  });

  it('handles shortcut icons and secure Open Graph images', () => {
    const html = `
      <html><head>
        <meta property="og:image:secure_url" content="/secure.png">
        <link rel="shortcut icon" href="/shortcut.ico">
      </head></html>`;

    const meta = parseMeta(html, 'https://example.com/article');

    expect(meta.imageUrl).toBe('https://example.com/secure.png');
    expect(meta.faviconUrl).toBe('https://example.com/shortcut.ico');
  });
});
