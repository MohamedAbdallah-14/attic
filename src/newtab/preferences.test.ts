import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDeletePreference, setDeletePreference } from './preferences';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
});

describe('preferences', () => {
  it('defaults to ask', () => {
    expect(readDeletePreference()).toBe('ask');
  });
  it('persists attic-only and both choices', () => {
    setDeletePreference('attic');
    expect(readDeletePreference()).toBe('attic');
    setDeletePreference('both');
    expect(readDeletePreference()).toBe('both');
  });
  it('resets when set to ask', () => {
    setDeletePreference('both');
    setDeletePreference('ask');
    expect(readDeletePreference()).toBe('ask');
  });
});
