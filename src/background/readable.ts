export const SNAPSHOT_MAX = 4000;

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

export function extractReadable(html: string, baseUrl: string): string | undefined {
  void baseUrl;
  if (!html) return undefined;

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const text = decodeHtml(
    body
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

  return text.length > 0 ? text.slice(0, SNAPSHOT_MAX) : undefined;
}
