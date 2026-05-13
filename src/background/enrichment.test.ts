import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPendingEnrichment = vi.fn();
const patch = vi.fn();
const fetchAndStoreImage = vi.fn().mockResolvedValue(true);

vi.mock('../storage/bookmarks', () => ({
  listPendingEnrichment,
  patch,
}));

vi.mock('../storage/images', () => ({ fetchAndStoreImage }));

describe('enrichment queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    globalThis.chrome = {
      alarms: {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;
  });

  it('returns zero when there is no pending work', async () => {
    listPendingEnrichment.mockResolvedValue([]);
    const { runQueue } = await import('./enrichment');

    await expect(runQueue()).resolves.toEqual({ processed: 0 });
    expect(listPendingEnrichment).toHaveBeenCalledWith(4);
    expect(patch).not.toHaveBeenCalled();
  });

  it('enriches HTML pages with metadata and snapshot text', async () => {
    listPendingEnrichment.mockResolvedValue([
      { id: 1, url: 'https://example.com/post', enrichmentAttempts: 0 },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `<html><head>
            <title>Fallback title</title>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG description">
            <meta property="og:image" content="/image.png">
            <link rel="icon" href="/favicon.ico">
          </head><body><article>Hello <strong>reader</strong></article></body></html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      ),
    );
    const { runQueue } = await import('./enrichment');

    await expect(runQueue()).resolves.toEqual({ processed: 1 });
    expect(patch).toHaveBeenCalledWith(1, {
      title: 'OG Title',
      description: 'OG description',
      imageUrl: 'https://example.com/image.png',
      faviconUrl: 'https://example.com/favicon.ico',
      snapshotText: 'Hello reader',
      enrichment: 'ok',
      enrichmentAttempts: 1,
    });
  });

  it('keeps retryable failures pending and marks exhausted failures failed', async () => {
    listPendingEnrichment.mockResolvedValue([
      { id: 1, url: 'https://retry.example', enrichmentAttempts: 0 },
      { id: 2, url: 'https://failed.example', enrichmentAttempts: 2 },
    ]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('nope', { status: 404 }))
        .mockResolvedValueOnce(
          new Response('plain text', { headers: { 'content-type': 'text/plain' } }),
        ),
    );
    const { runQueue } = await import('./enrichment');

    await expect(runQueue()).resolves.toEqual({ processed: 2 });
    expect(patch).toHaveBeenCalledWith(1, { enrichment: 'pending', enrichmentAttempts: 1 });
    expect(patch).toHaveBeenCalledWith(2, { enrichment: 'failed', enrichmentAttempts: 3 });
  });

  it('caches og:image bytes when enrichment finds an image', async () => {
    listPendingEnrichment.mockResolvedValue([
      { id: 5, url: 'https://example.com/post', urlHash: 'h5', enrichmentAttempts: 0 },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `<html><head>
            <title>T</title>
            <meta property="og:image" content="https://cdn.example.com/img.png">
          </head><body></body></html>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );
    const { runQueue } = await import('./enrichment');
    await runQueue();
    expect(fetchAndStoreImage).toHaveBeenCalledWith('h5', 'https://cdn.example.com/img.png');
  });

  it('runs a burst until the queue is empty or maxRounds is exhausted', async () => {
    listPendingEnrichment
      .mockResolvedValueOnce([
        { id: 1, url: 'https://a.example', urlHash: 'a', enrichmentAttempts: 0 },
      ])
      .mockResolvedValueOnce([
        { id: 2, url: 'https://b.example', urlHash: 'b', enrichmentAttempts: 0 },
      ])
      .mockResolvedValueOnce([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html><head><title>x</title></head></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    const { runBurst } = await import('./enrichment');
    await expect(runBurst()).resolves.toEqual({ processed: 2 });
  });

  it('registers the periodic alarm and ignores unrelated alarms', async () => {
    const { registerEnrichment } = await import('./enrichment');
    listPendingEnrichment.mockResolvedValue([]);

    registerEnrichment();
    expect(chrome.alarms.create).toHaveBeenCalledWith('bm-enrichment-tick', { periodInMinutes: 1 });

    const alarmHandler = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0]?.[0];
    await alarmHandler?.({ name: 'other', scheduledTime: 1 });
    expect(listPendingEnrichment).not.toHaveBeenCalled();
    await alarmHandler?.({ name: 'bm-enrichment-tick', scheduledTime: 2 });
    expect(listPendingEnrichment).toHaveBeenCalledWith(4);
  });
});
