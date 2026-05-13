import '../styles/tailwind.css';
import type { CapturePayload, MessageResponse, RuntimeMessage } from '../shared/types';
import { parsePocketHtml } from '../storage/importers/pocket-html';

type Destination = 'reading' | 'bookmarks';

const rootEl = document.getElementById('popup-root');
if (!rootEl) throw new Error('popup root missing');
const appRoot = rootEl;

let busy = false;
let activeTab: chrome.tabs.Tab | null = null;

let destination: Destination =
  (localStorage.getItem('attic-default-capture') as Destination | null) ?? 'reading';
let savedState: { destination: Destination } | null = null;
let stats: { bookmarks: number; reading: number; done: number } | null = null;
let moreOpen = false;
let tagsInput = '';
let confirmClearOpen = false;

async function send<T = unknown>(msg: RuntimeMessage): Promise<MessageResponse<T>> {
  return (await chrome.runtime.sendMessage(msg)) as MessageResponse<T>;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function domainLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

function setBusy(next: boolean): void {
  busy = next;
  render();
}

function setDestination(next: Destination): void {
  destination = next;
  localStorage.setItem('attic-default-capture', next);
  render();
}

async function activeChromeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;
  return activeTab;
}

async function refreshStats(): Promise<void> {
  const response = await send<{ bookmarks: number; reading: number; done: number }>({
    type: 'popup-stats',
  });
  if (response.ok) {
    stats = response.data;
    render();
  }
}

async function doSave(): Promise<void> {
  if (!activeTab?.url) return;
  setBusy(true);
  try {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const response = await send({
      type: 'capture',
      payload: {
        url: activeTab.url,
        title: activeTab.title,
        source: 'manual',
        tags: tags.length ? tags : undefined,
        destination,
      } as CapturePayload,
    });
    if (response.ok) {
      savedState = { destination };
      setTimeout(() => {
        savedState = null;
        render();
      }, 2500);
      void refreshStats();
    }
  } finally {
    setBusy(false);
  }
}

async function importPocketFile(file: File): Promise<void> {
  setBusy(true);
  try {
    const text = await file.text();
    const rows = parsePocketHtml(text);

    const response = await send<{ inserted: number }>({
      type: 'import-pocket',
      payload: { rows },
    });
    if (!response.ok) throw new Error(response.error);
    void refreshStats();
  } catch (error) {
    void error;
  } finally {
    busy = false;
    render();
  }
}

async function runAction<T>(fn: () => Promise<T>): Promise<void> {
  setBusy(true);
  try {
    await fn();
  } catch {
    // swallow; action state is not tracked in new UI
  } finally {
    busy = false;
    render();
  }
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderBrandRow(): HTMLElement {
  const row = el('div', 'flex items-center justify-between mb-3');

  const left = el('div', 'flex items-center gap-2');
  const mark = el('div', 'size-6 rounded bg-[#5f43d6] flex items-center justify-center text-white text-[10px] font-bold', 'A');
  left.appendChild(mark);
  left.appendChild(el('span', 'text-sm font-semibold tracking-[-0.02em]', 'Attic'));
  row.appendChild(left);

  const gear = el('button', 'size-7 rounded flex items-center justify-center text-[#7f8da0] hover:text-white hover:bg-[#1a2536] transition', '⚙');
  gear.type = 'button';
  gear.title = 'Settings';
  gear.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  row.appendChild(gear);

  return row;
}

function renderCurrentPageCard(): HTMLElement {
  const card = el('div', 'rounded-xl border border-[#1e2d3f] bg-[#0d1623] px-3 py-2.5 mb-3 flex items-center gap-2.5');

  if (activeTab?.favIconUrl) {
    const favicon = el('img', 'size-6 rounded flex-shrink-0') as HTMLImageElement;
    favicon.src = activeTab.favIconUrl;
    favicon.alt = '';
    card.appendChild(favicon);
  } else {
    const placeholder = el('div', 'size-6 rounded flex-shrink-0 bg-[#1a2536] flex items-center justify-center text-[#4a5568] text-xs', '🔗');
    card.appendChild(placeholder);
  }

  const text = el('div', 'min-w-0 flex-1');
  const title = el('p', 'text-sm font-medium truncate leading-tight', activeTab?.title ?? 'No active tab');
  text.appendChild(title);
  if (activeTab?.url) {
    const host = el('p', 'text-xs text-[#7f8da0] truncate mt-0.5', domainLabel(activeTab.url));
    text.appendChild(host);
  }
  card.appendChild(text);

  return card;
}

function renderDestinationControl(): HTMLElement {
  const wrap = el('div', 'flex rounded-xl bg-[#0d1623] border border-[#1e2d3f] p-1 mb-3 gap-1');

  const readingBtn = el('button', '', '★ Reading list');
  readingBtn.type = 'button';
  readingBtn.className = destination === 'reading'
    ? 'flex-1 rounded-lg py-1.5 text-sm font-semibold bg-[#5f43d6] text-white transition'
    : 'flex-1 rounded-lg py-1.5 text-sm font-medium text-[#7f8da0] hover:text-white transition';
  readingBtn.addEventListener('click', () => setDestination('reading'));

  const bookmarksBtn = el('button', '', '📁 Bookmarks');
  bookmarksBtn.type = 'button';
  bookmarksBtn.className = destination === 'bookmarks'
    ? 'flex-1 rounded-lg py-1.5 text-sm font-semibold bg-[#5f43d6] text-white transition'
    : 'flex-1 rounded-lg py-1.5 text-sm font-medium text-[#7f8da0] hover:text-white transition';
  bookmarksBtn.addEventListener('click', () => setDestination('bookmarks'));

  wrap.appendChild(readingBtn);
  wrap.appendChild(bookmarksBtn);
  return wrap;
}

function renderTagsInput(): HTMLElement {
  const wrap = el('div', 'mb-3');
  const input = el('input', 'w-full rounded-xl border border-[#1e2d3f] bg-[#0d1623] px-3 py-2 text-sm text-[#f4f7fb] placeholder-[#4a5a6e] outline-none focus:border-[#5f43d6] transition');
  input.type = 'text';
  input.placeholder = 'Add tags (comma separated)';
  input.value = tagsInput;
  input.disabled = busy;
  input.addEventListener('input', () => {
    tagsInput = input.value;
  });
  wrap.appendChild(input);
  return wrap;
}

function renderSaveButton(): HTMLElement {
  if (savedState) {
    const wrap = el('div', 'mb-3 rounded-xl bg-[#1a3d2a] border border-[#2a5c3a] px-4 py-3 flex items-center justify-between');
    const label = destination === 'reading' ? 'Saved to Reading list' : 'Saved to Bookmarks';
    wrap.appendChild(el('span', 'text-sm font-semibold text-[#5cb87a]', `✓ ${label}`));
    const link = el('a', 'text-xs text-[#5f43d6] hover:underline cursor-pointer', 'Open Attic');
    link.addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://newtab' }));
    wrap.appendChild(link);
    return wrap;
  }

  const btn = el('button', '', busy ? 'Saving…' : destination === 'reading' ? 'Save to Reading list' : 'Save to Bookmarks');
  btn.type = 'button';
  btn.disabled = busy || !activeTab?.url;
  btn.className = 'w-full rounded-xl bg-[#5f43d6] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(95,67,214,0.35)] hover:bg-[#6f53ff] disabled:opacity-50 transition mb-3';
  btn.addEventListener('click', () => void doSave());
  return btn;
}

function renderStatsRow(): HTMLElement {
  const row = el('div', 'flex gap-2 mb-3');
  const items: Array<{ label: string; value: number | string }> = [
    { label: 'Bookmarks', value: stats?.bookmarks ?? '—' },
    { label: 'Reading', value: stats?.reading ?? '—' },
    { label: 'Done', value: stats?.done ?? '—' },
  ];
  for (const item of items) {
    const tile = el('div', 'flex-1 rounded-xl border border-[#1e2d3f] bg-[#0d1623] px-2 py-2 text-center');
    tile.appendChild(el('p', 'text-base font-bold text-[#f4f7fb] leading-none', String(item.value)));
    tile.appendChild(el('p', 'text-[10px] text-[#5a6a7e] mt-1', item.label));
    row.appendChild(tile);
  }
  return row;
}

function renderMoreSection(): HTMLElement {
  const wrap = el('div', 'mb-3');

  const toggle = el('button', 'w-full flex items-center justify-between rounded-xl border border-[#1e2d3f] bg-[#0d1623] px-3 py-2 text-xs font-medium text-[#7f8da0] hover:border-[#5f43d6]/40 hover:text-white transition');
  toggle.type = 'button';
  const toggleLabel = el('span', '', 'More actions');
  const chevron = el('span', `transition-transform duration-200${moreOpen ? ' rotate-180' : ''}`, '▾');
  toggle.appendChild(toggleLabel);
  toggle.appendChild(chevron);
  toggle.addEventListener('click', () => {
    moreOpen = !moreOpen;
    render();
  });
  wrap.appendChild(toggle);

  if (moreOpen) {
    const panel = el('div', 'mt-1 rounded-xl border border-[#1e2d3f] bg-[#0d1623] overflow-hidden divide-y divide-[#1e2d3f]');

    const resync = el('button', 'w-full px-3 py-2.5 text-left text-xs font-medium text-[#c5d0dd] hover:bg-[#0f1d2e] transition disabled:opacity-50', 'Re-sync Chrome bookmarks');
    resync.type = 'button';
    resync.disabled = busy;
    resync.addEventListener('click', () => {
      void runAction(async () => {
        const response = await send({ type: 'resync-bookmarks' });
        if (!response.ok) throw new Error(response.error);
      });
    });
    panel.appendChild(resync);

    const rerun = el('button', 'w-full px-3 py-2.5 text-left text-xs font-medium text-[#c5d0dd] hover:bg-[#0f1d2e] transition disabled:opacity-50', 'Re-run failed enrichment');
    rerun.type = 'button';
    rerun.disabled = busy;
    rerun.addEventListener('click', () => {
      void runAction(async () => {
        const response = await send({ type: 'rerun-failed-enrichment' });
        if (!response.ok) throw new Error(response.error);
      });
    });
    panel.appendChild(rerun);

    const importLabel = el('label', 'block w-full px-3 py-2.5 text-left text-xs font-medium text-[#c5d0dd] hover:bg-[#0f1d2e] cursor-pointer transition', 'Import Pocket export…');
    const fileInput = el('input', 'hidden');
    fileInput.type = 'file';
    fileInput.accept = '.html,text/html';
    fileInput.disabled = busy;
    fileInput.addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const selected = input.files?.[0];
      if (selected) void importPocketFile(selected);
      input.value = '';
    });
    importLabel.appendChild(fileInput);
    panel.appendChild(importLabel);

    if (confirmClearOpen) {
      const confirmRow = el('div', 'px-3 py-2.5 bg-[#1a0808]');
      confirmRow.appendChild(el('p', 'text-xs text-red-300 mb-2', 'Delete all local bookmarks data? This cannot be undone.'));
      const btnRow = el('div', 'flex gap-2');
      const cancelClear = el('button', 'flex-1 rounded-lg border border-[#263241] py-1 text-xs text-[#7f8da0] hover:text-white transition', 'Cancel');
      cancelClear.type = 'button';
      cancelClear.addEventListener('click', () => {
        confirmClearOpen = false;
        render();
      });
      btnRow.appendChild(cancelClear);
      const confirmClear = el('button', 'flex-1 rounded-lg bg-red-600 py-1 text-xs font-semibold text-white hover:bg-red-500 transition disabled:opacity-50', 'Delete everything');
      confirmClear.type = 'button';
      confirmClear.disabled = busy;
      confirmClear.addEventListener('click', () => {
        confirmClearOpen = false;
        void runAction(async () => {
          const response = await send({ type: 'clear-all' });
          if (!response.ok) throw new Error(response.error);
        });
      });
      btnRow.appendChild(confirmClear);
      confirmRow.appendChild(btnRow);
      panel.appendChild(confirmRow);
    } else {
      const clear = el('button', 'w-full px-3 py-2.5 text-left text-xs font-medium text-red-300 hover:bg-red-500/10 transition disabled:opacity-50', 'Clear all local data');
      clear.type = 'button';
      clear.disabled = busy;
      clear.addEventListener('click', () => {
        confirmClearOpen = true;
        render();
      });
      panel.appendChild(clear);
    }

    const openAttic = el('button', 'w-full px-3 py-2.5 text-left text-xs font-medium text-[#c5d0dd] hover:bg-[#0f1d2e] transition', 'Open Attic in a new tab');
    openAttic.type = 'button';
    openAttic.addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://newtab' }));
    panel.appendChild(openAttic);

    wrap.appendChild(panel);
  }

  return wrap;
}

function renderFooter(): HTMLElement {
  const footer = el('div', 'text-center');
  const pkg = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
  footer.appendChild(
    el('p', 'text-[10px] text-[#3d4f62]', `${pkg ? `v${pkg} · ` : ''}Local-only`),
  );
  return footer;
}

function render(): void {
  const shell = el('div', 'p-4 flex flex-col');

  shell.appendChild(renderBrandRow());
  shell.appendChild(renderCurrentPageCard());
  shell.appendChild(renderDestinationControl());
  shell.appendChild(renderTagsInput());
  shell.appendChild(renderSaveButton());
  shell.appendChild(renderStatsRow());
  shell.appendChild(renderMoreSection());
  shell.appendChild(renderFooter());

  appRoot.replaceChildren(shell);
}

render();

void (async () => {
  await activeChromeTab();
  render();
  void refreshStats();
})();

declare const __APP_VERSION__: string | undefined;
