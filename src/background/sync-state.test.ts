import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('sync state', () => {
  const store = new Map<string, unknown>();

  beforeEach(() => {
    vi.resetModules();
    store.clear();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) store.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('claims sync when no fresh sync or active lock exists', async () => {
    const { claimSync } = await import('./sync-state');

    await expect(claimSync(1_000)).resolves.toBe(true);
    await expect(claimSync(2_000)).resolves.toBe(false);
  });

  it('skips fresh syncs and allows stale syncs', async () => {
    const { claimSync, finishSync } = await import('./sync-state');

    await claimSync(1_000);
    await finishSync(1_000);

    await expect(claimSync(1_000 + 60_000)).resolves.toBe(false);
    await expect(claimSync(1_000 + 16 * 60_000)).resolves.toBe(true);
  });

  it('recovers from stale locks without marking sync as completed', async () => {
    const { claimSync, releaseSync } = await import('./sync-state');

    await claimSync(1_000);
    await releaseSync();
    await expect(claimSync(2_000)).resolves.toBe(true);
  });
});
