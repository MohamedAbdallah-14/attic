export interface ParsedMeta {
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  siteName?: string;
}

type Attributes = Record<string, string>;

function resolve(maybeUrl: string | undefined, base: string): string | undefined {
  if (!maybeUrl) return undefined;

  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return undefined;
  }
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, raw: string) => {
    if (raw.startsWith('#x')) return String.fromCodePoint(Number.parseInt(raw.slice(2), 16));
    if (raw.startsWith('#')) return String.fromCodePoint(Number.parseInt(raw.slice(1), 10));
    return named[raw.toLowerCase()] ?? entity;
  });
}

function parseAttributes(tag: string): Attributes {
  const attrs: Attributes = {};
  const attrRe = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(tag))) {
    const [, name, doubleQuoted, singleQuoted, unquoted] = match;
    if (!name) continue;
    attrs[name.toLowerCase()] = decodeHtml(doubleQuoted ?? singleQuoted ?? unquoted ?? '').trim();
  }

  return attrs;
}

function tags(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return html.match(re) ?? [];
}

function meta(html: string, key: string): string | undefined {
  const wanted = key.toLowerCase();
  for (const tag of tags(html, 'meta')) {
    const attrs = parseAttributes(tag);
    const name = attrs.property?.toLowerCase() ?? attrs.name?.toLowerCase();
    if (name === wanted && attrs.content) return attrs.content;
  }
  return undefined;
}

function link(html: string, rel: string): string | undefined {
  const wanted = rel.toLowerCase().split(/\s+/).filter(Boolean);
  for (const tag of tags(html, 'link')) {
    const attrs = parseAttributes(tag);
    const rels = new Set((attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean));
    if (wanted.every((value) => rels.has(value)) && attrs.href) return attrs.href;
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return undefined;
  return decodeHtml(match[1].replace(/<[^>]*>/g, '').trim()) || undefined;
}

export function parseMeta(html: string, baseUrl: string): ParsedMeta {
  if (!html) return {};

  const title = meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? extractTitle(html);
  const description =
    meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description');
  const rawImage =
    meta(html, 'og:image') ??
    meta(html, 'og:image:secure_url') ??
    meta(html, 'twitter:image') ??
    meta(html, 'twitter:image:src');
  const imageUrl = resolve(rawImage, baseUrl);
  const rawIcon =
    link(html, 'icon') ?? link(html, 'shortcut icon') ?? link(html, 'apple-touch-icon');
  const faviconUrl = resolve(rawIcon, baseUrl) ?? resolve('/favicon.ico', baseUrl);
  const siteName = meta(html, 'og:site_name');

  const out: ParsedMeta = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (imageUrl) out.imageUrl = imageUrl;
  if (faviconUrl) out.faviconUrl = faviconUrl;
  if (siteName) out.siteName = siteName;

  return out;
}
