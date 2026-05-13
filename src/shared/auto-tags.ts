const KNOWN_SITE_TAGS: Record<string, string[]> = {
  facebook: ['social'],
  github: ['code'],
  gitlab: ['code'],
  instagram: ['social'],
  medium: ['reading'],
  nesslabs: ['reading'],
  spotify: ['audio'],
  stackoverflow: ['code'],
  substack: ['reading'],
  tiktok: ['social', 'video'],
  twitter: ['social'],
  x: ['social'],
  youtu: ['video'],
  youtube: ['video'],
};

export function deriveAutoTags(rawUrl: string): string[] {
  const site = siteTag(rawUrl);
  if (!site) return [];
  return mergeTags([site], KNOWN_SITE_TAGS[site]);
}

const SKIPPED_FOLDER_TITLES = new Set([
  'bookmarks bar',
  'bookmarks',
  'other bookmarks',
  'other',
  'mobile bookmarks',
  'mobile',
]);

export function deriveFolderTags(folderPath: string[]): string[] {
  const tags: string[] = [];
  for (const raw of folderPath) {
    const normalized = normalizeTag(raw);
    if (!normalized) continue;
    if (SKIPPED_FOLDER_TITLES.has(raw.trim().toLowerCase())) continue;
    tags.push(normalized);
  }
  return [...new Set(tags)];
}

export function mergeTags(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  return [
    ...new Set([...(existing ?? []), ...(incoming ?? [])].map(normalizeTag).filter(Boolean)),
  ].sort();
}

function siteTag(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    const base = parts.length > 1 ? parts.at(-2) : parts[0];
    return base ? normalizeTag(base) : null;
  } catch {
    return null;
  }
}

function normalizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
