const SYNC_STATE_KEY = 'attic-sync-state';
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const LOCK_TTL_MS = 2 * 60 * 1000;

interface SyncState {
  lastChromeBookmarkSyncAt?: number;
  syncStartedAt?: number;
}

async function getSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(SYNC_STATE_KEY);
  return (result[SYNC_STATE_KEY] as SyncState | undefined) ?? {};
}

async function setSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: state });
}

export async function claimSync(now = Date.now()): Promise<boolean> {
  const state = await getSyncState();
  const activeLock = state.syncStartedAt != null && now - state.syncStartedAt < LOCK_TTL_MS;
  if (activeLock) return false;

  const freshSync =
    state.lastChromeBookmarkSyncAt != null && now - state.lastChromeBookmarkSyncAt < SYNC_INTERVAL_MS;
  if (freshSync) return false;

  await setSyncState({ ...state, syncStartedAt: now });
  return true;
}

export async function finishSync(now = Date.now()): Promise<void> {
  const { syncStartedAt: _syncStartedAt, ...state } = await getSyncState();
  await setSyncState({ ...state, lastChromeBookmarkSyncAt: now });
}

export async function releaseSync(): Promise<void> {
  const { syncStartedAt: _syncStartedAt, ...state } = await getSyncState();
  await setSyncState(state);
}
