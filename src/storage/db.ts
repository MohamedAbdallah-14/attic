import type { Bookmark } from '../shared/types';

const DB_NAME = 'attic';
const DB_VERSION = 3;
const BOOKMARKS_STORE = 'bookmarks';
const IMAGES_STORE = 'images';

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
        const store = db.createObjectStore(BOOKMARKS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('urlHash', 'urlHash', { unique: true });
        store.createIndex('capturedAt', 'capturedAt');
        store.createIndex('lastShownAt', 'lastShownAt');
        store.createIndex('consumedAt', 'consumedAt');
        store.createIndex('source', 'source');
        store.createIndex('enrichment', 'enrichment');
        store.createIndex('removed', 'removed');
        store.createIndex('chromeId', 'chromeId', { unique: false });
      }

      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: 'urlHash' });
      }

      if (event.oldVersion < 3 && db.objectStoreNames.contains(BOOKMARKS_STORE)) {
        const tx = request.transaction;
        const store = tx?.objectStore(BOOKMARKS_STORE);
        if (store && !store.indexNames.contains('chromeId')) {
          store.createIndex('chromeId', 'chromeId', { unique: false });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function withBookmarksStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS_STORE, mode);
  const store = transaction.objectStore(BOOKMARKS_STORE);

  try {
    const result = await callback(store);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

export async function withImagesStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(IMAGES_STORE, mode);
  const store = transaction.objectStore(IMAGES_STORE);

  try {
    const result = await callback(store);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

export type { Bookmark };
