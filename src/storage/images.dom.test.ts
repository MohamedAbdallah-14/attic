import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteCachedImage,
  fetchAndStoreImage,
  getCachedImage,
  hasCachedImage,
  putCachedImage,
} from './images';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('delete database blocked'));
  });
}

describe('image cache', () => {
  beforeEach(async () => {
    await deleteDatabase('attic');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts, gets, has, and deletes a cached image', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await putCachedImage({
      urlHash: 'h1',
      blob,
      contentType: 'image/png',
      byteSize: blob.size,
      fetchedAt: 42,
    });

    expect(await hasCachedImage('h1')).toBe(true);
    const row = await getCachedImage('h1');
    expect(row?.byteSize).toBe(3);
    expect(row?.contentType).toBe('image/png');

    await deleteCachedImage('h1');
    expect(await hasCachedImage('h1')).toBe(false);
  });

  it('fetches a remote image and stores it', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        blob: () => Promise.resolve(blob),
      }) as unknown as typeof fetch,
    );

    const stored = await fetchAndStoreImage('h2', 'https://cdn.example.com/x.jpg');
    expect(stored).toBe(true);
    const row = await getCachedImage('h2');
    expect(row?.byteSize).toBe(4);
  });

  it('rejects non-image content types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        blob: () => Promise.resolve(new Blob([])),
      }) as unknown as typeof fetch,
    );
    expect(await fetchAndStoreImage('h3', 'https://x.test/y.html')).toBe(false);
    expect(await hasCachedImage('h3')).toBe(false);
  });

  it('rejects empty or oversized blobs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        blob: () => Promise.resolve(new Blob([])),
      }) as unknown as typeof fetch,
    );
    expect(await fetchAndStoreImage('h4', 'https://x.test/y.png')).toBe(false);
  });

  it('returns false on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, headers: { get: () => '' } }) as unknown as typeof fetch,
    );
    expect(await fetchAndStoreImage('h5', 'https://x.test/y.png')).toBe(false);
  });

  it('returns false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);
    expect(await fetchAndStoreImage('h6', 'https://x.test/y.png')).toBe(false);
  });
});
