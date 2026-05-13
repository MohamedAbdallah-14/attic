export type BookmarkSource =
  | 'chrome-bookmarks'
  | 'manual'
  | 'shortcut'
  | 'context-menu'
  // legacy: emitted by the content-script per-site injection feature removed
  // in 1.0.1. Kept in the union so display code can render existing rows from
  // 1.0.0 installs. No production writer.
  | `site:${string}`
  | 'pocket-import';

export type EnrichmentStatus = 'pending' | 'ok' | 'failed';

export type ThemePreference = 'system' | 'dark' | 'light' | 'attic';

export interface Bookmark {
  id?: number;
  chromeId?: string;
  url: string;
  urlHash: string;
  title: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  siteName?: string;
  source: BookmarkSource;
  capturedAt: number;
  shownCount: number;
  lastShownAt?: number;
  consumedAt?: number;
  readingListAt?: number;
  removed?: boolean;
  snapshotText?: string;
  tags?: string[];
  enrichment: EnrichmentStatus;
  enrichmentAttempts: number;
}

export interface CapturePayload {
  url: string;
  title?: string;
  source: BookmarkSource;
  tags?: string[];
  destination?: 'reading' | 'bookmarks';
  // null = explicit "do not auto-add to reading list" (used by ask-mode capture before the user chooses)
  readingListAt?: number | null;
}

export interface PocketImportPayload {
  rows: Array<{ url: string; title: string; capturedAt?: number; tags?: string[] }>;
}

export interface FolderSummary {
  id: string;
  title: string;
  path: string[];
}

export type RuntimeMessage =
  | { type: 'capture'; payload: CapturePayload }
  | { type: 'maybe-sync-bookmarks' }
  | { type: 'resync-bookmarks' }
  | { type: 'rerun-failed-enrichment' }
  | { type: 'clear-all' }
  | { type: 'import-pocket'; payload: PocketImportPayload }
  | { type: 'enrichment-status' }
  | { type: 'kick-burst-enrichment' }
  | { type: 'ping' }
  | { type: 'list-folders' }
  | { type: 'update-tags'; payload: { bookmarkId: number; tags: string[] } }
  | { type: 'apply-folder-tag'; payload: { bookmarkId: number; folderId: string } }
  | { type: 'create-folder-and-move'; payload: { bookmarkId: number; title: string; parentId: string } }
  | { type: 'delete-bookmark'; payload: { bookmarkId: number; scope: 'attic' | 'both' } }
  | { type: 'toggle-reading-list'; payload: { bookmarkId: number; add: boolean } }
  | { type: 'popup-stats' }
  | { type: 'image-cache-stats' }
  | { type: 'local-activity' }
  | { type: 'export-data' };

export type MessageResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
