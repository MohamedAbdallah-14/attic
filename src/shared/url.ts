const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  'igshid',
  'si',
]);

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeUrl(raw: string): string {
  if (!isHttpUrl(raw)) return raw;
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (TRACKING_PARAMS.has(k)) continue;
    if (TRACKING_PARAM_PREFIXES.some((p) => k.startsWith(p))) continue;
    keep.append(k, v);
  }
  u.search = keep.toString() ? `?${keep.toString()}` : '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.toString();
}

export async function hashUrl(raw: string): Promise<string> {
  const normalized = normalizeUrl(raw);
  const buf = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
