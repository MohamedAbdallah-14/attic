import { describe, expect, it } from 'vitest';
import { hashUrl, isHttpUrl, normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('strips the hash fragment', () => {
    expect(normalizeUrl('https://example.com/a#frag')).toBe('https://example.com/a');
  });

  it('lowercases the host', () => {
    expect(normalizeUrl('https://EXAMPLE.com/a')).toBe('https://example.com/a');
  });

  it('strips utm_ and known tracking params', () => {
    expect(normalizeUrl('https://example.com/x?utm_source=x&fbclid=1&gclid=2&id=keep')).toBe(
      'https://example.com/x?id=keep',
    );
  });

  it('drops trailing slash on path', () => {
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a');
  });

  it('preserves root /', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns input unchanged for non-http URLs', () => {
    expect(normalizeUrl('chrome://newtab')).toBe('chrome://newtab');
  });
});

describe('hashUrl', () => {
  it('returns a hex string of length 64 (sha-256)', async () => {
    const h = await hashUrl('https://example.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two normalized-equivalent URLs hash to the same value', async () => {
    const a = await hashUrl('https://example.com/x?utm_source=z');
    const b = await hashUrl('https://example.com/x');
    expect(a).toBe(b);
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://x')).toBe(true);
    expect(isHttpUrl('https://x')).toBe(true);
  });

  it('rejects chrome://, file://, javascript:', () => {
    expect(isHttpUrl('chrome://newtab')).toBe(false);
    expect(isHttpUrl('file:///etc/hosts')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});
