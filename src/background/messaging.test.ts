import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '../shared/types';

describe('runtime messaging', () => {
  let callback:
    | ((
        msg: RuntimeMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean)
    | undefined;

  beforeEach(() => {
    vi.resetModules();
    callback = undefined;
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            callback = listener;
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('wraps handler results and unknown message errors', async () => {
    const { on, startMessaging } = await import('./messaging');
    on('clear-all', async () => ({ cleared: true }));
    startMessaging();

    const responses: unknown[] = [];
    expect(callback?.({ type: 'clear-all' }, {}, (response) => responses.push(response))).toBe(true);
    await Promise.resolve();
    expect(responses).toEqual([{ ok: true, data: { cleared: true } }]);

    const unknownResponses: unknown[] = [];
    expect(
      callback?.(
        { type: 'missing' } as unknown as RuntimeMessage,
        {},
        (response) => unknownResponses.push(response),
      ),
    ).toBe(false);
    expect(unknownResponses).toEqual([{ ok: false, error: 'unknown message: missing' }]);
  });

  it('serializes thrown handler errors and registers ping', async () => {
    vi.setSystemTime(1_234);
    const { on, startMessaging } = await import('./messaging');
    on('clear-all', async () => {
      throw new Error('boom');
    });
    startMessaging();

    const errorResponses: unknown[] = [];
    callback?.({ type: 'clear-all' }, {}, (response) => errorResponses.push(response));
    await Promise.resolve();
    expect(errorResponses).toEqual([{ ok: false, error: 'boom' }]);

    const pingResponses: unknown[] = [];
    callback?.({ type: 'ping' }, {}, (response) => pingResponses.push(response));
    await Promise.resolve();
    expect(pingResponses).toEqual([{ ok: true, data: { pong: 1_234 } }]);
  });
});
