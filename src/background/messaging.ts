import type { MessageResponse, RuntimeMessage } from '../shared/types';

type Handler<M extends RuntimeMessage = RuntimeMessage> = (
  msg: M,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown>;

const handlers = new Map<RuntimeMessage['type'], Handler>();

export function on<T extends RuntimeMessage['type']>(
  type: T,
  handler: Handler<Extract<RuntimeMessage, { type: T }>>,
): void {
  handlers.set(type, handler as Handler);
}

export function startMessaging(): void {
  chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
    const handler = handlers.get(msg.type);
    if (!handler) {
      sendResponse({ ok: false, error: `unknown message: ${msg.type}` } satisfies MessageResponse);
      return false;
    }

    (async () => {
      try {
        const data = await handler(msg, sender);
        sendResponse({ ok: true, data } satisfies MessageResponse);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: message } satisfies MessageResponse);
      }
    })();

    return true;
  });

  on('ping', async () => ({ pong: Date.now() }));
}
