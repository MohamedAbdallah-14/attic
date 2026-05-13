import { describe, expect, it } from 'vitest';
import manifest from './manifest';

interface ManifestLike {
  manifest_version: number;
  name?: string;
  chrome_url_overrides?: unknown;
  permissions?: unknown[];
  content_scripts?: unknown[];
}

describe('extension manifest', () => {
  it('declares MV3 surfaces and required permissions, no content scripts', async () => {
    const resolved = (await Promise.resolve(manifest)) as unknown as ManifestLike;

    expect(resolved.manifest_version).toBe(3);
    expect(resolved.name).toBe('Attic');
    expect(resolved.chrome_url_overrides).toEqual({ newtab: 'src/newtab/index.html' });
    expect(resolved.permissions).toEqual(
      expect.arrayContaining(['bookmarks', 'contextMenus', 'alarms', 'activeTab', 'unlimitedStorage']),
    );
    expect(resolved.permissions).not.toContain('tabs');
    expect(resolved.content_scripts).toBeUndefined();
  });
});
