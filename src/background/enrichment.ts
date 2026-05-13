import { shouldRetry } from '../shared/backoff';
import { listPendingEnrichment, patch } from '../storage/bookmarks';
import { fetchAndStoreImage } from '../storage/images';
import { parseMeta } from './og-parser';
import { extractReadable } from './readable';

const CONCURRENCY = 4;
const BURST_CONCURRENCY = 8;
const ALARM_NAME = 'bm-enrichment-tick';

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: 'text/html,*/*;q=0.8' },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('xml')) {
    throw new Error(`unsupported content-type: ${contentType}`);
  }

  return response.text();
}

async function enrichOne(
  id: number,
  url: string,
  urlHash: string,
  attemptsSoFar: number,
): Promise<void> {
  try {
    const html = await fetchHtml(url);
    const meta = parseMeta(html, url);
    const snapshotText = extractReadable(html, url);

    await patch(id, {
      ...meta,
      snapshotText,
      enrichment: 'ok',
      enrichmentAttempts: attemptsSoFar + 1,
    });

    if (meta.imageUrl) {
      void fetchAndStoreImage(urlHash, meta.imageUrl);
    }
  } catch (error) {
    const attempts = attemptsSoFar + 1;
    const enrichment = shouldRetry(attempts) ? 'pending' : 'failed';
    await patch(id, { enrichment, enrichmentAttempts: attempts });
    console.warn('[attic] enrichment failed', url, String(error));
  }
}

export async function runQueue(concurrency: number = CONCURRENCY): Promise<{ processed: number }> {
  const pending = await listPendingEnrichment(concurrency);
  if (pending.length === 0) return { processed: 0 };

  await Promise.all(
    pending.map((bookmark) =>
      enrichOne(bookmark.id!, bookmark.url, bookmark.urlHash, bookmark.enrichmentAttempts),
    ),
  );

  return { processed: pending.length };
}

export async function runBurst(maxRounds: number = 6): Promise<{ processed: number }> {
  let total = 0;
  for (let i = 0; i < maxRounds; i += 1) {
    const result = await runQueue(BURST_CONCURRENCY);
    if (result.processed === 0) break;
    total += result.processed;
  }
  return { processed: total };
}

export function registerEnrichment(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    await runQueue();
  });
}

export async function kickEnrichment(): Promise<void> {
  await runQueue();
}

export async function kickBurstEnrichment(): Promise<{ processed: number }> {
  return runBurst();
}
