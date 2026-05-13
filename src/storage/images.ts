import { requestToPromise, withImagesStore } from './db';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export interface CachedImage {
  urlHash: string;
  blob: Blob;
  contentType: string;
  byteSize: number;
  fetchedAt: number;
}

export function getCachedImage(urlHash: string): Promise<CachedImage | undefined> {
  return withImagesStore('readonly', (store) =>
    requestToPromise<CachedImage | undefined>(store.get(urlHash)),
  );
}

export async function hasCachedImage(urlHash: string): Promise<boolean> {
  const row = await getCachedImage(urlHash);
  return row != null;
}

export async function putCachedImage(image: CachedImage): Promise<void> {
  await withImagesStore('readwrite', async (store) => {
    await requestToPromise(store.put(image));
  });
}

export async function deleteCachedImage(urlHash: string): Promise<void> {
  await withImagesStore('readwrite', async (store) => {
    await requestToPromise(store.delete(urlHash));
  });
}

export async function fetchAndStoreImage(urlHash: string, imageUrl: string): Promise<boolean> {
  try {
    const response = await fetch(imageUrl, { method: 'GET', redirect: 'follow' });
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') ?? '';
    if (!ALLOWED_TYPES.some((type) => contentType.includes(type))) return false;
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > MAX_BYTES) return false;
    await putCachedImage({
      urlHash,
      blob,
      contentType: blob.type || contentType,
      byteSize: blob.size,
      fetchedAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}
