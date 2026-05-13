import { isHttpUrl } from '../../shared/url';

export interface PocketImportRow {
  url: string;
  title: string;
  capturedAt?: number;
  tags?: string[];
}

export function parsePocketHtml(html: string): PocketImportRow[] {
  if (!html) return [];

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: PocketImportRow[] = [];

  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = anchor.getAttribute('href') ?? '';
    if (!isHttpUrl(url)) continue;

    const addDate = anchor.getAttribute('add_date') ?? anchor.getAttribute('ADD_DATE');
    const capturedAt = addDate ? Number(addDate) * 1000 : undefined;
    const tags = parseTags(anchor.getAttribute('tags') ?? anchor.getAttribute('TAGS') ?? '');

    out.push({
      url,
      title: anchor.textContent?.trim() || url,
      capturedAt: Number.isFinite(capturedAt) ? capturedAt : undefined,
      tags,
    });
  }

  return out;
}

function parseTags(value: string): string[] | undefined {
  const tags = [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return tags.length > 0 ? tags : undefined;
}
