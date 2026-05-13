import { describe, expect, it } from 'vitest';
import { extractReadable, SNAPSHOT_MAX } from './readable';

describe('extractReadable service-worker compatibility', () => {
  it('extracts text without DOMParser', () => {
    const text = extractReadable(
      '<html><body><script>alert(1)</script><article><h1>Hello</h1><p>Saved &amp; readable.</p></article></body></html>',
      'https://example.com',
    );

    expect(text).toBe('Hello Saved & readable.');
  });

  it('caps snapshot text', () => {
    const text = extractReadable(`<p>${'a'.repeat(SNAPSHOT_MAX + 20)}</p>`, 'https://example.com');

    expect(text).toHaveLength(SNAPSHOT_MAX);
  });

  it('decodes numeric entities and returns undefined for empty markup', () => {
    expect(extractReadable('<body>Tom &amp; Jerry &#65; &#x42;</body>', 'https://example.com')).toBe(
      'Tom & Jerry A B',
    );
    expect(
      extractReadable('<script>const hidden = true</script>', 'https://example.com'),
    ).toBeUndefined();
  });
});
