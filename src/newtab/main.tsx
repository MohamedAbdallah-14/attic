import '../styles/tailwind.css';
import type { Bookmark, BookmarkSource, ThemePreference } from '../shared/types';
import { incrementShown, listForFeed, patch } from '../storage/bookmarks';
import { getCachedImage } from '../storage/images';
import { pickN } from './feed';
import { findFolderByTitle, listFolders } from './folder-picker';
import { readDeletePreference, setDeletePreference } from './preferences';
import {
  availableSources,
  type ConsumedFilter,
  filterBookmarks,
  parseTags,
  tagCounts,
} from './library';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('newtab root element missing');
const appRoot = rootEl;

const HERO_COUNT = 1;
const SECONDARY_COUNT = 3;
const PAGE_SIZE = 12;
const POOL_FETCH = 200;
const THEME_PREFERENCE_KEY = 'attic-theme-preference';
const ACCENT_PREFERENCE_KEY = 'attic-accent';
const DEFAULT_ACCENT = '#6f53ff';

type ViewTab = 'discover' | 'bookmarks' | 'reading' | 'done';
let viewTab: ViewTab = 'discover';

let items: Bookmark[] = [];
let pool: Bookmark[] = [];
let allItems: Bookmark[] = [];
let exhausted = false;
let revealed = false;
let focusIndex = 0;
let query = '';
let sourceFilter: BookmarkSource | 'all' = 'all';
let tagFilter: string | 'all' = 'all';
let tagMenuOpen = false;
let tagMenuQuery = '';
let consumedFilter: ConsumedFilter = 'active'; // discover tab default
let readingListFilter: 'all' | 'in' | 'out' = 'all';
let editingTags: Bookmark | null = null;
let tagMenuPanel: HTMLElement | null = null;
let tagMenuAnchor: HTMLButtonElement | null = null;
let themePreference: ThemePreference = readThemePreference();
let theme: 'dark' | 'light' = resolveTheme(themePreference);
let accent: string = readAccent();
let renderToken = 0;
let enrichmentStatus: { pending: number; ok: number; failed: number } | null = null;
let enrichmentTimer: number | null = null;
let folderPrompt: { bookmark: Bookmark; tag: string } | null = null;
let folderPicker: { bookmark: Bookmark; query: string } | null = null;
let pendingDelete: Bookmark | null = null;
let toastMessage = '';
let toastTimer: number | null = null;
const exclude = new Set<string>();
const objectUrls = new Set<string>();
const imageCache = new Map<string, string | null>();

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

function flashToast(text: string): void {
  toastMessage = text;
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMessage = '';
    render();
  }, 2500);
  render();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function sourceLabelFromSource(source: BookmarkSource): string {
  if (source.startsWith('site:')) return source.replace('site:', '');
  return source.replace(/-/g, ' ');
}

function sourceLabel(bookmark: Bookmark): string {
  return sourceLabelFromSource(bookmark.source);
}

function initials(value: string): string {
  return value
    .split(/[.\-\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function openBookmark(bookmark: Bookmark, opts: { newTab?: boolean } = {}): void {
  if (opts.newTab) {
    window.open(bookmark.url, '_blank');
  } else {
    window.location.href = bookmark.url;
  }
}

function readThemePreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_PREFERENCE_KEY);
  if (saved === 'system' || saved === 'dark' || saved === 'light' || saved === 'attic') return saved;
  return 'system';
}

function readAccent(): string {
  const saved = localStorage.getItem(ACCENT_PREFERENCE_KEY);
  if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) return saved;
  return DEFAULT_ACCENT;
}

function resolveTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference === 'light') return 'light';
  if (preference === 'dark' || preference === 'attic') return 'dark';
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyAccent(): void {
  document.documentElement.style.setProperty('--attic-accent', accent);
  document.documentElement.style.setProperty('--attic-accent-soft', `${accent}33`);
  document.documentElement.style.setProperty('--attic-accent-glow', `${accent}45`);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PALETTE_SEEDS = [
  ['#3a1f57', '#5b2a8a'],
  ['#0e3d36', '#127064'],
  ['#1f3a5f', '#2a5d92'],
  ['#572717', '#9e4226'],
  ['#3d2853', '#7c3aed'],
  ['#1a3a2a', '#2e7d4f'],
  ['#4a1f3a', '#9d2a73'],
];

function paletteFor(bookmark: Bookmark): [string, string] {
  const seed = hashString(bookmark.siteName ?? hostname(bookmark.url));
  const palette = PALETTE_SEEDS[seed % PALETTE_SEEDS.length] ?? PALETTE_SEEDS[0]!;
  return [palette[0]!, palette[1]!];
}

async function consumeBookmark(bookmark: Bookmark): Promise<void> {
  if (bookmark.id == null) return;
  const consumedAt = bookmark.consumedAt ? undefined : Date.now();
  await patch(bookmark.id, { consumedAt });
  replaceBookmark({ ...bookmark, consumedAt });
  render();
}

async function saveTags(bookmark: Bookmark, value: string): Promise<void> {
  if (bookmark.id == null) return;
  const tags = parseTags(value);
  const existing = bookmark.tags ?? [];
  const addedTags = tags.filter((tag) => !existing.includes(tag));

  const response = await chrome.runtime.sendMessage({
    type: 'update-tags',
    payload: { bookmarkId: bookmark.id, tags },
  });
  replaceBookmark({ ...bookmark, tags });
  editingTags = null;

  const data = response?.ok ? (response.data as { moved: boolean; folderTitle?: string }) : null;
  if (data?.moved && data.folderTitle) {
    flashToast(`Moved to "${data.folderTitle}"`);
  } else if (addedTags.length > 0 && bookmark.chromeId) {
    const candidate = addedTags[0]!;
    const folder = await findFolderByTitle(candidate);
    if (!folder) folderPrompt = { bookmark, tag: candidate };
  }
  applyLibraryMode();
}

function replaceBookmark(next: Bookmark): void {
  const replace = (bookmark: Bookmark) => (bookmark.urlHash === next.urlHash ? next : bookmark);
  items = items.map(replace);
  pool = pool.map(replace);
  allItems = allItems.map(replace);
}

function filtersActive(): boolean {
  return (
    Boolean(query.trim()) ||
    sourceFilter !== 'all' ||
    tagFilter !== 'all'
  );
}

function applyLibraryMode(): void {
  focusIndex = 0;
  const tabFilteredItems = filterBookmarks(allItems, {
    consumed: consumedFilter,
    readingList: readingListFilter,
  });
  if (filtersActive()) {
    items = filterBookmarks(tabFilteredItems, {
      query,
      source: sourceFilter,
      tag: tagFilter,
    }).slice(0, 200);
    exhausted = true;
    render();
    return;
  }

  exclude.clear();
  items = [];
  pool = [...tabFilteredItems];
  exhausted = pool.length === 0;
  loadMore();
}

function setViewTab(next: ViewTab): void {
  viewTab = next;
  query = '';
  sourceFilter = 'all';
  tagFilter = 'all';
  if (next === 'discover') {
    consumedFilter = 'active';
    readingListFilter = 'all';
    revealed = false;
  } else if (next === 'bookmarks') {
    consumedFilter = 'all';
    readingListFilter = 'all';
    revealed = true;
  } else if (next === 'reading') {
    consumedFilter = 'active';
    readingListFilter = 'in';
    revealed = true;
  } else {
    consumedFilter = 'consumed';
    readingListFilter = 'all';
    revealed = true;
  }
  applyLibraryMode();
}

function syncThemeFromStorage(): void {
  const nextPreference = readThemePreference();
  const nextAccent = readAccent();
  const changed = nextPreference !== themePreference || nextAccent !== accent;
  if (!changed) return;
  themePreference = nextPreference;
  theme = resolveTheme(nextPreference);
  accent = nextAccent;
  document.documentElement.style.colorScheme = theme;
  applyAccent();
  render();
}

function requestBackgroundSync(): void {
  void chrome.runtime.sendMessage({ type: 'maybe-sync-bookmarks' }).catch(() => undefined);
}

async function refreshEnrichmentStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'enrichment-status' });
    if (response?.ok && response.data) {
      enrichmentStatus = response.data as { pending: number; ok: number; failed: number };
      renderEnrichmentBanner();
    }
  } catch {
    /* ignore */
  }
}

function scheduleEnrichmentPolling(): void {
  if (enrichmentTimer != null) return;
  void refreshEnrichmentStatus();
  enrichmentTimer = window.setInterval(() => {
    if (!enrichmentStatus || enrichmentStatus.pending === 0) {
      if (enrichmentTimer != null) {
        clearInterval(enrichmentTimer);
        enrichmentTimer = null;
      }
      renderEnrichmentBanner();
      return;
    }
    void refreshEnrichmentStatus();
  }, 4000);
}

function releaseObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

async function attachCachedImage(image: HTMLImageElement, bookmark: Bookmark): Promise<void> {
  if (bookmark.id == null) return;
  const token = renderToken;
  const cached = imageCache.get(bookmark.urlHash);
  if (cached === null) return;
  if (cached) {
    image.src = cached;
    return;
  }
  try {
    const row = await getCachedImage(bookmark.urlHash);
    if (token !== renderToken) return;
    if (!row) {
      imageCache.set(bookmark.urlHash, null);
      return;
    }
    const url = URL.createObjectURL(row.blob);
    if (token !== renderToken || !image.isConnected) {
      URL.revokeObjectURL(url);
      return;
    }
    objectUrls.add(url);
    imageCache.set(bookmark.urlHash, url);
    image.src = url;
  } catch {
    if (token === renderToken) imageCache.set(bookmark.urlHash, null);
  }
}

function renderPlaceholder(bookmark: Bookmark, size: 'hero' | 'card'): HTMLElement {
  const host = hostname(bookmark.url);
  const [from, to] = paletteFor(bookmark);
  const heightClass = size === 'hero' ? 'h-64 sm:h-72' : 'h-40';
  const placeholder = el(
    'div',
    `flex ${heightClass} w-full items-center justify-center overflow-hidden`,
  );
  placeholder.style.background = `linear-gradient(135deg, ${from}, ${to})`;

  const inner = el('div', 'flex flex-col items-center gap-2 text-white/85');
  if (bookmark.faviconUrl) {
    const favicon = el(
      'img',
      'size-10 rounded-md bg-white/95 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)]',
    );
    favicon.src = bookmark.faviconUrl;
    favicon.alt = '';
    favicon.loading = 'lazy';
    favicon.addEventListener('error', () => favicon.remove());
    inner.appendChild(favicon);
  }
  inner.appendChild(
    el(
      'div',
      'text-2xl font-semibold tracking-[-0.04em] drop-shadow',
      bookmark.siteName ?? host,
    ),
  );
  if (size === 'hero') {
    inner.appendChild(
      el(
        'div',
        'rounded-full bg-black/30 px-3 py-1 text-[0.7rem] uppercase tracking-[0.2em] text-white/80',
        initials(bookmark.siteName ?? host) || 'A',
      ),
    );
  }
  placeholder.appendChild(inner);
  return placeholder;
}

interface CardOptions {
  size: 'hero' | 'card';
  index: number;
}

function renderCard(bookmark: Bookmark, options: CardOptions): HTMLElement {
  const focused = options.index === focusIndex;
  const palette = theme === 'dark' ? '#0f1825' : '#ffffff';
  const border = theme === 'dark' ? '#27344a' : '#e3e8f0';
  const card = el(
    'article',
    [
      'group relative flex flex-col overflow-hidden rounded-2xl border transition duration-200',
      options.size === 'hero' ? 'sm:col-span-3' : '',
      focused ? 'ring-2 ring-offset-2' : 'hover:-translate-y-0.5',
    ]
      .filter(Boolean)
      .join(' '),
  );
  card.style.background = palette;
  card.style.borderColor = border;
  card.style.boxShadow =
    theme === 'dark' ? '0 16px 40px rgba(0,0,0,0.28)' : '0 12px 32px rgba(15,23,42,0.08)';
  if (focused) {
    card.style.setProperty('--tw-ring-color', accent);
    card.style.setProperty('--tw-ring-offset-color', theme === 'dark' ? '#08111d' : '#e8edf4');
  }
  card.dataset.urlHash = bookmark.urlHash;

  const media = el('div', 'relative overflow-hidden');
  if (bookmark.imageUrl) {
    const image = el(
      'img',
      `${options.size === 'hero' ? 'h-64 sm:h-72' : 'h-40'} w-full object-cover transition duration-500 group-hover:scale-105`,
    );
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.replaceWith(renderPlaceholder(bookmark, options.size));
    });
    void attachCachedImage(image, bookmark).then(() => {
      if (!image.src) image.src = bookmark.imageUrl!;
    });
    media.appendChild(image);
  } else {
    media.appendChild(renderPlaceholder(bookmark, options.size));
  }
  card.appendChild(media);

  const body = el('div', 'flex flex-1 flex-col gap-3 p-4');

  const source = el(
    'div',
    `flex items-center gap-2 text-[0.7rem] ${theme === 'dark' ? 'text-[#aab6c5]' : 'text-[#586678]'}`,
  );
  if (bookmark.faviconUrl) {
    const favicon = el('img', 'size-4 rounded bg-white/95 p-0.5');
    favicon.src = bookmark.faviconUrl;
    favicon.alt = '';
    favicon.loading = 'lazy';
    favicon.addEventListener('error', () => favicon.remove());
    source.appendChild(favicon);
  }
  source.appendChild(
    el(
      'span',
      `truncate font-medium ${theme === 'dark' ? 'text-[#dce6f5]' : 'text-[#0d1623]'}`,
      bookmark.siteName ?? hostname(bookmark.url),
    ),
  );
  source.appendChild(el('span', 'opacity-50', '·'));
  source.appendChild(el('span', 'capitalize', sourceLabel(bookmark)));
  body.appendChild(source);

  const titleSize = options.size === 'hero' ? 'text-xl' : 'text-base';
  const title = el(
    'button',
    `text-left ${titleSize} font-semibold leading-snug outline-none transition ${theme === 'dark' ? 'text-[#f4f7fb] hover:text-white' : 'text-[#0d1623] hover:text-black'}`,
    bookmark.title || bookmark.url,
  );
  title.type = 'button';
  title.addEventListener('click', (event) => {
    event.stopPropagation();
    openBookmark(bookmark, { newTab: event.metaKey || event.ctrlKey || event.shiftKey });
  });
  body.appendChild(title);

  if (bookmark.description) {
    body.appendChild(
      el(
        'p',
        `${options.size === 'hero' ? 'line-clamp-3' : 'line-clamp-2'} text-xs leading-5 ${theme === 'dark' ? 'text-[#bac6d5]' : 'text-[#475569]'}`,
        bookmark.description,
      ),
    );
  }

  const tags = el('div', 'flex flex-wrap items-center gap-1.5');
  for (const tag of bookmark.tags ?? []) {
    const chip = el(
      'span',
      'rounded-md border px-2 py-0.5 text-[0.65rem]',
      `#${tag}`,
    );
    chip.style.borderColor = `${accent}40`;
    chip.style.background = `${accent}22`;
    chip.style.color = theme === 'dark' ? '#e9e2ff' : accent;
    tags.appendChild(chip);
  }
  const editTags = el(
    'button',
    `rounded-md border px-2 py-0.5 text-[0.65rem] transition ${theme === 'dark' ? 'border-white/10 text-[#aab6c5] hover:text-white' : 'border-[#cbd5e1] text-[#475569] hover:text-[#0d1623]'}`,
    bookmark.tags?.length ? 'Edit tags' : 'Add tags',
  );
  editTags.type = 'button';
  editTags.addEventListener('click', () => {
    editingTags = bookmark;
    render();
  });
  tags.appendChild(editTags);
  body.appendChild(tags);

  const meta = el(
    'div',
    `mt-auto flex flex-wrap items-center gap-2 text-[0.7rem] ${theme === 'dark' ? 'text-[#aab6c5]' : 'text-[#586678]'}`,
  );
  const metaChipClass =
    theme === 'dark'
      ? 'max-w-full truncate rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5'
      : 'max-w-full truncate rounded-md border border-[#dbe1ea] bg-white px-2 py-0.5';
  meta.appendChild(el('span', metaChipClass, hostname(bookmark.url)));
  meta.appendChild(el('time', metaChipClass, formatDate(bookmark.capturedAt)));
  if (bookmark.consumedAt) {
    const done = el('span', 'rounded-md px-2 py-0.5');
    done.style.background = `${accent}28`;
    done.style.color = theme === 'dark' ? '#e9e2ff' : accent;
    done.textContent = 'done';
    meta.appendChild(done);
  }
  const spacer = el('div', 'flex-1');
  meta.appendChild(spacer);

  if (viewTab !== 'bookmarks' && viewTab !== 'discover') {
    const consume = el(
      'button',
      `rounded-md border px-2.5 py-0.5 transition ${theme === 'dark' ? 'border-white/10 text-[#dce6f5] hover:text-white' : 'border-[#cbd5e1] text-[#0d1623] hover:bg-[#f1f5f9]'}`,
      bookmark.consumedAt ? 'Undo done' : 'Mark done',
    );
    consume.type = 'button';
    consume.title = 'Shortcut: m';
    consume.addEventListener('click', () => void consumeBookmark(bookmark));
    meta.appendChild(consume);
  }

  const iconButtonClass = `grid size-7 place-items-center rounded-md border text-[0.75rem] transition ${theme === 'dark' ? 'border-white/10 text-[#aab6c5] hover:border-[#6f53ff]/60 hover:text-white' : 'border-[#cbd5e1] text-[#475569] hover:border-[#6f53ff]/60 hover:text-[#0d1623]'}`;

  if (viewTab !== 'reading' && viewTab !== 'done') {
    const inList = bookmark.readingListAt != null;
    const starBtn = el('button', `grid size-7 place-items-center rounded-md border text-[0.75rem] transition ${inList ? '' : (theme === 'dark' ? 'border-white/10 text-[#aab6c5]' : 'border-[#cbd5e1] text-[#475569]')} hover:border-[#6f53ff]/60`, inList ? '★' : '☆');
    starBtn.type = 'button';
    starBtn.title = inList ? 'Remove from reading list' : 'Add to reading list';
    if (inList) {
      starBtn.style.borderColor = accent;
      starBtn.style.color = accent;
    }
    starBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (bookmark.id == null) return;
      await chrome.runtime.sendMessage({
        type: 'toggle-reading-list',
        payload: { bookmarkId: bookmark.id, add: !inList },
      });
      replaceBookmark({
        ...bookmark,
        readingListAt: inList ? undefined : Date.now(),
      });
      flashToast(inList ? 'Removed from reading list' : 'Added to reading list');
      render();
    });
    meta.appendChild(starBtn);
  }

  const editBtn = el('button', iconButtonClass, '✎');
  editBtn.type = 'button';
  editBtn.title = 'Edit tags';
  editBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    editingTags = bookmark;
    render();
  });
  meta.appendChild(editBtn);

  const moveBtn = el('button', iconButtonClass, '⤴');
  moveBtn.type = 'button';
  moveBtn.title = 'Move to Chrome folder';
  moveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    folderPicker = { bookmark, query: '' };
    render();
  });
  meta.appendChild(moveBtn);

  const deleteBtn = el('button', `grid size-7 place-items-center rounded-md border text-[0.75rem] transition ${theme === 'dark' ? 'border-white/10 text-[#aab6c5] hover:border-[#e11d48]/60 hover:text-[#fda4af]' : 'border-[#cbd5e1] text-[#475569] hover:border-[#e11d48]/60 hover:text-[#e11d48]'}`, '✕');
  deleteBtn.type = 'button';
  deleteBtn.title = 'Delete bookmark';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    pendingDelete = bookmark;
    render();
  });
  meta.appendChild(deleteBtn);

  body.appendChild(meta);
  card.appendChild(body);

  card.style.cursor = 'pointer';
  card.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, a, input, label, select, textarea')) return;
    openBookmark(bookmark, { newTab: event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1 });
  });
  card.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, label, select, textarea')) return;
    event.preventDefault();
    openBookmark(bookmark, { newTab: true });
  });

  return card;
}

function renderHelp(open: boolean): HTMLElement | null {
  if (!open) return null;
  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm',
  );
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const panel = el(
    'div',
    'w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1825] p-6 text-[#f4f7fb] shadow-2xl',
  );
  overlay.addEventListener('click', () => {
    helpOpen = false;
    render();
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.appendChild(el('h2', 'mb-4 text-lg font-semibold', 'Keyboard shortcuts'));

  const list = el('dl', 'space-y-2 text-sm');
  for (const [key, description] of [
    ['j', 'next card'],
    ['k', 'previous card'],
    ['Enter', 'open focused card'],
    ['m', 'mark consumed'],
    ['?', 'show this overlay'],
    ['Esc', 'close overlay'],
  ]) {
    const row = el('div', 'flex justify-between');
    const term = el('dt');
    term.appendChild(
      el(
        'kbd',
        'rounded border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-xs',
        key,
      ),
    );
    row.appendChild(term);
    row.appendChild(el('dd', 'text-[#aab6c5]', description));
    list.appendChild(row);
  }
  panel.appendChild(list);
  const close = el(
    'button',
    'mt-6 rounded-full px-4 py-2 text-sm font-medium text-white',
    'Close',
  );
  close.style.background = accent;
  close.type = 'button';
  close.addEventListener('click', () => {
    helpOpen = false;
    render();
  });
  panel.appendChild(close);
  overlay.appendChild(panel);
  return overlay;
}

function renderTagEditor(bookmark: Bookmark | null): HTMLElement | null {
  if (!bookmark) return null;

  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm',
  );
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.addEventListener('click', () => {
    editingTags = null;
    render();
  });

  const panel = el(
    'form',
    'w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f1825] p-6 text-[#f4f7fb] shadow-2xl',
  );
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(panel);
    void saveTags(bookmark, String(data.get('tags') ?? ''));
  });

  panel.appendChild(el('h2', 'text-lg font-semibold', 'Edit tags'));
  panel.appendChild(
    el(
      'p',
      'mt-2 text-sm leading-6 text-[#aab6c5]',
      'Comma-separated tags like research, flutter, design.',
    ),
  );
  const label = el('label', 'mt-5 block text-sm font-medium', 'Tags');
  label.htmlFor = 'attic-tags-input';
  panel.appendChild(label);
  const input = el(
    'input',
    'mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 outline-none transition focus:border-white/30',
  );
  input.id = 'attic-tags-input';
  input.name = 'tags';
  input.value = bookmark.tags?.join(', ') ?? '';
  panel.appendChild(input);

  const footer = el('div', 'mt-6 flex justify-end gap-2');
  const cancel = el(
    'button',
    'min-h-11 rounded-full border border-white/10 px-4 text-sm',
    'Cancel',
  );
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    editingTags = null;
    render();
  });
  footer.appendChild(cancel);
  const save = el('button', 'min-h-11 rounded-full px-4 text-sm font-medium text-white', 'Save tags');
  save.style.background = accent;
  save.type = 'submit';
  footer.appendChild(save);
  panel.appendChild(footer);
  overlay.appendChild(panel);

  setTimeout(() => input.focus(), 0);
  return overlay;
}

function renderFolderPrompt(): HTMLElement | null {
  if (!folderPrompt) return null;
  const target = folderPrompt;
  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm',
  );
  overlay.addEventListener('click', () => {
    folderPrompt = null;
    render();
  });
  const panel = el(
    'div',
    'w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1825] p-6 text-[#f4f7fb] shadow-2xl',
  );
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.appendChild(
    el('h2', 'text-lg font-semibold', `Create a "${target.tag}" folder in Chrome?`),
  );
  panel.appendChild(
    el(
      'p',
      'mt-2 text-sm leading-6 text-[#aab6c5]',
      'No Chrome folder has this name. Pick a parent to create it under, or keep the tag Attic-only.',
    ),
  );

  const parentSelect = document.createElement('select');
  parentSelect.className =
    'mt-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[#f4f7fb]';
  parentSelect.id = 'folder-parent-select';
  void listFolders().then((folders) => {
    while (parentSelect.firstChild) parentSelect.removeChild(parentSelect.firstChild);
    const tops = folders.filter((folder) => folder.path.length === 1);
    for (const folder of tops) {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.title;
      parentSelect.appendChild(option);
    }
  });
  panel.appendChild(parentSelect);

  const footer = el('div', 'mt-6 flex justify-end gap-2');
  const keep = el(
    'button',
    'min-h-11 rounded-full border border-white/10 px-4 text-sm',
    'Keep tag only',
  );
  keep.type = 'button';
  keep.addEventListener('click', () => {
    folderPrompt = null;
    render();
  });
  footer.appendChild(keep);
  const createBtn = el(
    'button',
    'min-h-11 rounded-full px-4 text-sm font-medium text-white',
    'Create folder and move',
  );
  createBtn.style.background = accent;
  createBtn.type = 'button';
  createBtn.addEventListener('click', async () => {
    if (target.bookmark.id == null) return;
    const parentId = parentSelect.value || '1';
    const response = await chrome.runtime.sendMessage({
      type: 'create-folder-and-move',
      payload: { bookmarkId: target.bookmark.id, title: target.tag, parentId },
    });
    folderPrompt = null;
    if (response?.ok) flashToast(`Moved to "${target.tag}"`);
    render();
  });
  footer.appendChild(createBtn);
  panel.appendChild(footer);
  overlay.appendChild(panel);
  return overlay;
}

function renderFolderPicker(): HTMLElement | null {
  if (!folderPicker) return null;
  const target = folderPicker;
  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm',
  );
  overlay.addEventListener('click', () => {
    folderPicker = null;
    render();
  });
  const panel = el(
    'div',
    'w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1825] p-6 text-[#f4f7fb] shadow-2xl',
  );
  panel.addEventListener('click', (event) => event.stopPropagation());

  panel.appendChild(el('h2', 'text-lg font-semibold', 'Move to Chrome folder'));
  panel.appendChild(
    el(
      'p',
      'mt-2 text-sm leading-6 text-[#aab6c5]',
      'Pick a folder. The bookmark moves to it in Chrome.',
    ),
  );

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search folders...';
  search.value = target.query;
  search.className =
    'mt-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#f4f7fb] outline-none placeholder:text-[#7f8da0]';
  search.addEventListener('input', () => {
    target.query = search.value;
    redrawFolderPickerList(list);
  });
  panel.appendChild(search);

  const list = el(
    'div',
    'mt-3 max-h-72 overflow-y-auto rounded-xl border border-white/5 bg-white/[0.02]',
  );
  panel.appendChild(list);
  redrawFolderPickerList(list);

  const footer = el('div', 'mt-4 flex justify-end gap-2');
  const cancel = el(
    'button',
    'min-h-11 rounded-full border border-white/10 px-4 text-sm',
    'Cancel',
  );
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    folderPicker = null;
    render();
  });
  footer.appendChild(cancel);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  setTimeout(() => search.focus(), 0);
  return overlay;

  function redrawFolderPickerList(container: HTMLElement): void {
    while (container.firstChild) container.removeChild(container.firstChild);
    const placeholder = el(
      'div',
      'px-3 py-4 text-center text-xs text-[#7f8da0]',
      'Loading folders…',
    );
    container.appendChild(placeholder);

    void listFolders().then((folders) => {
      while (container.firstChild) container.removeChild(container.firstChild);
      const filter = target.query.trim().toLowerCase();
      const matches = filter
        ? folders.filter((folder) => folder.path.join(' / ').toLowerCase().includes(filter))
        : folders;
      if (matches.length === 0) {
        container.appendChild(
          el(
            'div',
            'px-3 py-4 text-center text-xs text-[#7f8da0]',
            folders.length === 0 ? 'No folders in Chrome yet.' : 'No folders match.',
          ),
        );
        return;
      }
      for (const folder of matches) {
        const row = el(
          'button',
          'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5',
          '',
        );
        row.type = 'button';
        row.appendChild(el('span', 'truncate', folder.path.join(' / ')));
        row.appendChild(el('span', 'text-[0.65rem] text-[#7f8da0]', `id ${folder.id}`));
        row.addEventListener('click', async () => {
          if (target.bookmark.id == null) return;
          const response = await chrome.runtime.sendMessage({
            type: 'apply-folder-tag',
            payload: { bookmarkId: target.bookmark.id, folderId: folder.id },
          });
          folderPicker = null;
          if (response?.ok) flashToast(`Moved to "${folder.title}"`);
          render();
        });
        container.appendChild(row);
      }
    });
  }
}

function renderDeleteConfirm(): HTMLElement | null {
  if (!pendingDelete) return null;
  const pref = readDeletePreference();
  if (pref !== 'ask') {
    const target = pendingDelete;
    pendingDelete = null;
    void performDelete(target, pref);
    return null;
  }

  const target = pendingDelete;
  const overlay = el(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm',
  );
  const panel = el(
    'div',
    'w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1825] p-6 text-[#f4f7fb] shadow-2xl',
  );
  panel.appendChild(el('h2', 'text-lg font-semibold', 'Delete bookmark?'));
  panel.appendChild(
    el(
      'p',
      'mt-2 text-sm leading-6 text-[#aab6c5]',
      'Where should this go away from?',
    ),
  );

  const remember = el('label', 'mt-4 flex items-center gap-2 text-xs text-[#aab6c5]');
  const rememberInput = document.createElement('input');
  rememberInput.type = 'checkbox';
  rememberInput.id = 'attic-delete-remember';
  remember.appendChild(rememberInput);
  remember.appendChild(el('span', '', 'Remember my choice (changeable in settings)'));
  panel.appendChild(remember);

  const footer = el('div', 'mt-6 flex flex-wrap justify-end gap-2');
  const cancel = el('button', 'min-h-11 rounded-full border border-white/10 px-4 text-sm', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    pendingDelete = null;
    render();
  });
  footer.appendChild(cancel);

  const onlyAttic = el('button', 'min-h-11 rounded-full border border-white/10 px-4 text-sm', 'Delete in Attic only');
  onlyAttic.type = 'button';
  onlyAttic.addEventListener('click', async () => {
    pendingDelete = null;
    if (rememberInput.checked) setDeletePreference('attic');
    await performDelete(target, 'attic');
  });
  footer.appendChild(onlyAttic);

  const both = el('button', 'min-h-11 rounded-full px-4 text-sm font-medium text-white', 'Delete in Attic and Chrome');
  both.style.background = '#e11d48';
  both.type = 'button';
  both.addEventListener('click', async () => {
    pendingDelete = null;
    if (rememberInput.checked) setDeletePreference('both');
    await performDelete(target, 'both');
  });
  footer.appendChild(both);
  panel.appendChild(footer);

  overlay.addEventListener('click', () => {
    pendingDelete = null;
    render();
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  overlay.appendChild(panel);
  return overlay;
}

async function performDelete(bookmark: Bookmark, scope: 'attic' | 'both'): Promise<void> {
  if (bookmark.id == null) return;
  await chrome.runtime.sendMessage({
    type: 'delete-bookmark',
    payload: { bookmarkId: bookmark.id, scope },
  });
  items = items.filter((row) => row.urlHash !== bookmark.urlHash);
  pool = pool.filter((row) => row.urlHash !== bookmark.urlHash);
  allItems = allItems.filter((row) => row.urlHash !== bookmark.urlHash);
  flashToast(scope === 'both' ? 'Deleted in Attic and Chrome' : 'Deleted in Attic');
  render();
}

function renderTagDropdown(): HTMLElement {
  const dark = theme === 'dark';
  const wrap = el('div', 'relative');
  const trigger = el(
    'button',
    `min-h-9 rounded-full border px-3 text-xs font-medium transition`,
    tagFilter === 'all' ? 'Tags' : `# ${tagFilter}`,
  ) as HTMLButtonElement;
  trigger.type = 'button';
  if (tagFilter !== 'all') {
    trigger.style.background = accent;
    trigger.style.borderColor = accent;
    trigger.style.color = '#ffffff';
  } else {
    trigger.style.background = dark ? '#09111c' : '#ffffff';
    trigger.style.borderColor = dark ? '#273445' : '#cbd5e1';
    trigger.style.color = dark ? '#dce6f5' : '#0d1623';
  }
  trigger.setAttribute('aria-expanded', String(tagMenuOpen));
  trigger.addEventListener('click', () => {
    tagMenuOpen = !tagMenuOpen;
    tagMenuQuery = '';
    render();
  });
  wrap.appendChild(trigger);

  if (tagFilter !== 'all') {
    const clear = el(
      'button',
      'ml-1 min-h-9 rounded-full border px-2 text-xs',
      '×',
    );
    clear.type = 'button';
    clear.title = 'Clear tag filter';
    clear.style.background = dark ? '#09111c' : '#ffffff';
    clear.style.borderColor = dark ? '#273445' : '#cbd5e1';
    clear.style.color = dark ? '#dce6f5' : '#0d1623';
    clear.addEventListener('click', () => {
      tagFilter = 'all';
      applyLibraryMode();
    });
    wrap.appendChild(clear);
  }

  if (!tagMenuOpen) return wrap;

  const menu = el(
    'div',
    `w-72 overflow-hidden rounded-xl border shadow-2xl ${dark ? 'border-[#27344a] bg-[#0f1825] text-[#dce6f5]' : 'border-[#dbe1ea] bg-white text-[#0d1623]'}`,
  );
  const search = el(
    'input',
    `w-full border-b px-3 py-2 text-sm outline-none ${dark ? 'border-[#27344a] bg-[#09111c] placeholder:text-[#7f8da0]' : 'border-[#e3e8f0] bg-white placeholder:text-[#94a3b8]'}`,
  );
  search.type = 'search';
  search.placeholder = 'Filter tags...';
  search.value = tagMenuQuery;
  search.addEventListener('input', () => {
    tagMenuQuery = search.value;
    redrawTagMenu(list);
  });
  menu.appendChild(search);

  const list = el('div', 'max-h-72 overflow-y-auto');
  redrawTagMenu(list);
  menu.appendChild(list);

  // Stash for portal attachment — do NOT append to wrap here
  tagMenuPanel = menu;
  tagMenuAnchor = trigger;
  setTimeout(() => search.focus(), 0);
  return wrap;
}

function attachTagMenu(): void {
  if (!tagMenuPanel || !tagMenuAnchor) return;
  const rect = tagMenuAnchor.getBoundingClientRect();
  tagMenuPanel.style.position = 'fixed';
  tagMenuPanel.style.top = `${rect.bottom + 8}px`;
  tagMenuPanel.style.right = `${window.innerWidth - rect.right}px`;
  tagMenuPanel.style.zIndex = '60';
  document.body.appendChild(tagMenuPanel);
  setTimeout(() => {
    document.addEventListener('mousedown', handleOutsideClick, true);
  }, 0);
}

function handleOutsideClick(event: MouseEvent): void {
  if (!tagMenuPanel || !tagMenuAnchor) return;
  const target = event.target as Node;
  if (tagMenuPanel.contains(target) || tagMenuAnchor.contains(target)) return;
  tagMenuOpen = false;
  document.removeEventListener('mousedown', handleOutsideClick, true);
  render();
}

function redrawTagMenu(list: HTMLElement): void {
  const dark = theme === 'dark';
  list.replaceChildren();
  const all = tagCounts(allItems);
  const filtered = tagMenuQuery
    ? all.filter(({ tag }) => tag.includes(tagMenuQuery.toLowerCase()))
    : all;

  const allRow = el(
    'button',
    `flex w-full items-center justify-between px-3 py-2 text-sm transition ${dark ? 'hover:bg-white/5' : 'hover:bg-[#f1f5f9]'} ${tagFilter === 'all' ? 'font-semibold' : ''}`,
  );
  allRow.type = 'button';
  allRow.appendChild(el('span', '', 'All tags'));
  allRow.appendChild(el('span', `text-xs ${dark ? 'text-[#7f8da0]' : 'text-[#94a3b8]'}`, String(allItems.length)));
  allRow.addEventListener('click', () => {
    tagFilter = 'all';
    tagMenuOpen = false;
    applyLibraryMode();
  });
  list.appendChild(allRow);

  if (filtered.length === 0) {
    list.appendChild(
      el('div', `px-3 py-4 text-center text-xs ${dark ? 'text-[#7f8da0]' : 'text-[#94a3b8]'}`, 'No matching tags'),
    );
    return;
  }

  for (const { tag, count } of filtered) {
    const active = tagFilter === tag;
    const row = el(
      'button',
      `flex w-full items-center justify-between px-3 py-2 text-sm transition ${dark ? 'hover:bg-white/5' : 'hover:bg-[#f1f5f9]'} ${active ? 'font-semibold' : ''}`,
    );
    row.type = 'button';
    if (active) row.style.color = accent;
    row.appendChild(el('span', 'truncate', `#${tag}`));
    row.appendChild(el('span', `text-xs ${dark ? 'text-[#7f8da0]' : 'text-[#94a3b8]'}`, String(count)));
    row.addEventListener('click', () => {
      tagFilter = tag;
      tagMenuOpen = false;
      applyLibraryMode();
    });
    list.appendChild(row);
  }
}

let helpOpen = false;
let sentinel: HTMLDivElement | null = null;

async function fetchPool(): Promise<void> {
  allItems = await listForFeed({ limit: POOL_FETCH });
  pool = allItems.filter((bookmark) => !exclude.has(bookmark.urlHash));
  if (pool.length === 0) exhausted = true;
}

function loadMore(): void {
  if (filtersActive()) return;
  if (pool.length === 0) {
    exhausted = true;
    render();
    return;
  }
  if (viewTab === 'discover') {
    const target = revealed ? PAGE_SIZE : HERO_COUNT + SECONDARY_COUNT;
    const next = pickN(pool, Date.now(), target, exclude);
    if (next.length === 0) {
      exhausted = true;
      render();
      return;
    }
    items = [...items, ...next];
    for (const bookmark of next) {
      if (bookmark.id != null) void incrementShown(bookmark.id);
    }
    pool = pool.filter((bookmark) => !exclude.has(bookmark.urlHash));
  } else {
    const next = pool.splice(0, PAGE_SIZE);
    items = [...items, ...next];
    exhausted = pool.length === 0;
  }
  render();
}

function renderLibraryControls(): HTMLElement {
  const dark = theme === 'dark';
  const wrap = el(
    'section',
    `mb-5 flex flex-col gap-3 rounded-xl border px-3 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.16)] md:flex-row md:items-center ${dark ? 'border-[#263241] bg-[#0d1623]/95 backdrop-blur' : 'border-[#dbe1ea] bg-white/95 backdrop-blur'}`,
  );
  wrap.setAttribute('aria-label', 'Search and filter saved links');

  const brand = el('div', 'flex shrink-0 items-center gap-2 pr-2');
  const mark = el('div', 'grid size-8 place-items-center rounded-lg text-sm text-white', '⌂');
  mark.style.background = accent;
  mark.style.boxShadow = `0 10px 24px ${accent}59`;
  brand.appendChild(mark);
  brand.appendChild(
    el('div', `text-xl font-semibold tracking-[-0.04em] ${dark ? 'text-[#f4f7fb]' : 'text-[#0d1623]'}`, 'Attic'),
  );
  wrap.appendChild(brand);

  const searchWrap = el(
    'div',
    `flex min-h-10 flex-1 items-center gap-2 rounded-full border px-4 ${dark ? 'border-[#273445] bg-[#09111c] text-[#aab6c5]' : 'border-[#cbd5e1] bg-[#f8fafc] text-[#586678]'}`,
  );
  searchWrap.appendChild(el('span', 'text-sm opacity-60', '⌕'));
  const search = el(
    'input',
    `min-h-10 flex-1 bg-transparent text-sm outline-none ${dark ? 'text-[#f4f7fb] placeholder:text-[#7f8da0]' : 'text-[#0d1623] placeholder:text-[#94a3b8]'}`,
  );
  search.type = 'search';
  search.placeholder = 'Search titles, descriptions, URLs, or tags...';
  search.ariaLabel = 'Search saved links';
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    applyLibraryMode();
  });
  searchWrap.appendChild(search);
  searchWrap.appendChild(
    el(
      'span',
      `rounded-md px-2 py-1 text-xs ${dark ? 'bg-white/5 text-[#7f8da0]' : 'bg-[#e2e8f0] text-[#586678]'}`,
      '/',
    ),
  );
  wrap.appendChild(searchWrap);

  const filters = el('div', 'flex flex-wrap items-center gap-2 md:justify-end');
  const chipBase =
    'min-h-9 rounded-full border px-3 text-xs font-medium transition focus:outline-none';
  const applySourceChipStyle = (node: HTMLButtonElement, active: boolean) => {
    if (active) {
      node.style.background = accent;
      node.style.borderColor = accent;
      node.style.color = '#ffffff';
      node.style.boxShadow = `0 10px 24px ${accent}40`;
    } else {
      node.style.background = dark ? '#09111c' : '#ffffff';
      node.style.borderColor = dark ? '#273445' : '#cbd5e1';
      node.style.color = dark ? '#dce6f5' : '#0d1623';
      node.style.boxShadow = 'none';
    }
  };
  const chip = (label: string, active: boolean, onClick: () => void) => {
    const node = el('button', chipBase, label);
    node.type = 'button';
    applySourceChipStyle(node, active);
    node.setAttribute('aria-pressed', String(active));
    node.addEventListener('click', onClick);
    return node;
  };

  const sources = availableSources(allItems);
  if (sources.length > 1) {
    const sourceGroup = el('div', 'flex flex-wrap gap-1.5');
    sourceGroup.setAttribute('aria-label', 'Filter by source');
    sourceGroup.appendChild(
      chip('All sources', sourceFilter === 'all', () => {
        sourceFilter = 'all';
        applyLibraryMode();
      }),
    );
    for (const value of sources) {
      sourceGroup.appendChild(
        chip(sourceLabelFromSource(value), sourceFilter === value, () => {
          sourceFilter = value;
          applyLibraryMode();
        }),
      );
    }
    filters.appendChild(sourceGroup);
  }

  filters.appendChild(renderTagDropdown());

  const settings = el(
    'button',
    `grid size-10 place-items-center rounded-full border text-sm transition ${dark ? 'border-[#273445] bg-[#09111c] text-[#dce6f5]' : 'border-[#cbd5e1] bg-white text-[#0d1623]'}`,
    '⚙',
  );
  settings.type = 'button';
  settings.ariaLabel = 'Open settings';
  settings.title = 'Settings';
  settings.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  filters.appendChild(settings);

  const help = el(
    'button',
    `grid size-10 place-items-center rounded-full border text-sm transition ${dark ? 'border-[#273445] bg-[#09111c] text-[#dce6f5]' : 'border-[#cbd5e1] bg-white text-[#0d1623]'}`,
    '?',
  );
  help.type = 'button';
  help.ariaLabel = 'Show keyboard shortcuts';
  help.addEventListener('click', () => {
    helpOpen = true;
    render();
  });
  filters.appendChild(help);
  wrap.appendChild(filters);

  return wrap;
}

function renderEmptyState(): void {
  const dark = theme === 'dark';
  const main = el(
    'main',
    `min-h-screen px-6 py-10 ${dark ? 'bg-[#08111d] text-[#f4f7fb]' : 'bg-[#e8edf4] text-[#0d1623]'}`,
  );
  const wrap = el('div', 'mx-auto flex min-h-[75vh] max-w-2xl flex-col items-center justify-center gap-5 text-center');
  const tag = el('p', 'rounded-full px-3 py-1 text-xs uppercase tracking-[0.3em]', 'Attic');
  tag.style.background = `${accent}22`;
  tag.style.color = accent;
  wrap.appendChild(tag);
  wrap.appendChild(el('h1', 'text-5xl font-semibold tracking-[-0.06em]', 'Your attic is empty'));
  wrap.appendChild(
    el(
      'p',
      `max-w-md ${dark ? 'text-[#aab6c5]' : 'text-[#586678]'}`,
      'Sync Chrome bookmarks or save the current tab, then Attic will start surfacing older links when you open a new tab.',
    ),
  );
  const sync = el('button', 'rounded-full px-5 py-2.5 text-sm font-medium text-white transition', 'Sync now');
  sync.style.background = accent;
  sync.type = 'button';
  sync.addEventListener('click', async () => {
    exhausted = false;
    await chrome.runtime.sendMessage({ type: 'resync-bookmarks' });
    exclude.clear();
    await fetchPool();
    loadMore();
    render();
    scheduleEnrichmentPolling();
  });
  wrap.appendChild(sync);
  main.appendChild(wrap);
  appRoot.replaceChildren(main);
}

let enrichmentBannerEl: HTMLElement | null = null;

function renderEnrichmentBanner(): void {
  if (!enrichmentBannerEl) return;
  enrichmentBannerEl.replaceChildren();
  if (!enrichmentStatus || enrichmentStatus.pending === 0) return;
  const dark = theme === 'dark';
  const banner = el(
    'div',
    `flex items-center justify-between gap-3 rounded-xl border px-4 py-2 text-xs ${dark ? 'border-[#27344a] bg-[#0d1623] text-[#aab6c5]' : 'border-[#dbe1ea] bg-white text-[#475569]'}`,
  );
  const label = el('div', 'flex items-center gap-2');
  const dot = el('span', 'inline-block size-2 rounded-full');
  dot.style.background = accent;
  dot.style.animation = 'attic-pulse 1.2s infinite';
  label.appendChild(dot);
  const total = enrichmentStatus.pending + enrichmentStatus.ok + enrichmentStatus.failed;
  label.appendChild(
    el(
      'span',
      '',
      `Enriching links… ${enrichmentStatus.ok}/${total} ready, ${enrichmentStatus.pending} pending`,
    ),
  );
  banner.appendChild(label);
  const kick = el('button', 'rounded-full border px-3 py-1 text-xs transition', 'Speed up');
  kick.type = 'button';
  kick.style.borderColor = dark ? '#27344a' : '#dbe1ea';
  kick.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'kick-burst-enrichment' });
    scheduleEnrichmentPolling();
  });
  banner.appendChild(kick);
  enrichmentBannerEl.appendChild(banner);
}

function render(): void {
  if (tagMenuPanel && tagMenuPanel.parentElement) {
    tagMenuPanel.parentElement.removeChild(tagMenuPanel);
  }
  tagMenuPanel = null;
  tagMenuAnchor = null;
  renderToken += 1;
  releaseObjectUrls();
  imageCache.clear();
  focusIndex = Math.min(focusIndex, Math.max(items.length - 1, 0));

  const wholeStoreEmpty = allItems.length === 0;
  if (viewTab === 'discover' && !filtersActive() && wholeStoreEmpty) {
    renderEmptyState();
    return;
  }

  const dark = theme === 'dark';
  const main = el(
    'main',
    `min-h-screen overflow-hidden px-4 py-4 sm:px-6 ${dark ? 'bg-[#08111d] text-[#f4f7fb]' : 'bg-[#e8edf4] text-[#0d1623]'}`,
  );
  const shell = el('div', 'mx-auto max-w-[86rem]');
  shell.appendChild(renderLibraryControls());

  const tabs = el('div', `mb-5 flex gap-1 rounded-full border p-1 w-fit ${dark ? 'border-white/10' : 'border-[#dbe1ea]'}`);
  for (const [label, value] of [
    ['Discover', 'discover'],
    ['Bookmarks', 'bookmarks'],
    ['Reading list', 'reading'],
    ['Done', 'done'],
  ] as const) {
    const active = viewTab === value;
    const tab = el('button', 'min-h-9 rounded-full px-4 text-sm font-medium transition', label);
    tab.type = 'button';
    if (active) {
      tab.style.background = accent;
      tab.style.color = '#ffffff';
    } else {
      tab.style.background = 'transparent';
      tab.style.color = dark ? '#dce6f5' : '#0d1623';
    }
    tab.setAttribute('aria-pressed', String(active));
    tab.addEventListener('click', () => setViewTab(value));
    tabs.appendChild(tab);
  }
  shell.appendChild(tabs);

  enrichmentBannerEl = el('div', 'mb-4');
  shell.appendChild(enrichmentBannerEl);
  renderEnrichmentBanner();

  const sectionHead = el('div', 'mb-4 flex items-center justify-between gap-4 px-1');
  const titleByTab: Record<ViewTab, string> = {
    discover: filtersActive() ? 'Library results' : revealed ? 'From your archive' : 'Today from the attic',
    bookmarks: filtersActive() ? 'Library results' : 'Your bookmarks',
    reading: filtersActive() ? 'Reading list results' : 'Reading list',
    done: filtersActive() ? 'Done results' : 'Done',
  };
  sectionHead.appendChild(
    el('h2', `text-sm font-medium ${dark ? 'text-[#dce6f5]' : 'text-[#172335]'}`, titleByTab[viewTab]),
  );
  const subtitleByTab: Record<ViewTab, string> = {
    discover: filtersActive()
      ? `${items.length} matching saved links`
      : revealed
        ? `${items.length} pulled from your archive`
        : 'A short, curated pick. Reveal more when you want it.',
    bookmarks: filtersActive()
      ? `${items.length} matching saved links`
      : `${items.length} saved links across your archive`,
    reading: filtersActive()
      ? `${items.length} matching reading-list items`
      : `${items.length} on your reading list`,
    done: filtersActive()
      ? `${items.length} matching done items`
      : `${items.length} marked done from your reading list`,
  };
  sectionHead.appendChild(
    el('p', `text-xs ${dark ? 'text-[#7f8da0]' : 'text-[#586678]'}`, subtitleByTab[viewTab]),
  );
  shell.appendChild(sectionHead);

  if (items.length === 0) {
    const tabEmptyCopy: Record<ViewTab, { title: string; body: string }> = {
      discover: {
        title: 'Nothing left in this session',
        body: 'You have seen everything that matched. Open a new tab to start over.',
      },
      bookmarks: {
        title: 'No bookmarks yet',
        body: 'Sync Chrome bookmarks or save the current tab to fill this view.',
      },
      reading: {
        title: 'Your reading list is empty',
        body: 'Add a bookmark to the reading list with the ★ icon on any card, or capture a new one from the Attic popup.',
      },
      done: {
        title: 'Nothing done yet',
        body: 'Items you mark done from the reading list will live here. You can always undo done.',
      },
    };
    const copy = filtersActive()
      ? { title: 'No saved links match that', body: 'Try a broader search, another source, or clear the tag filter.' }
      : tabEmptyCopy[viewTab];

    const empty = el(
      'section',
      `rounded-2xl border p-8 text-center ${dark ? 'border-white/10 bg-white/[0.04]' : 'border-[#dbe1ea] bg-white'}`,
    );
    empty.appendChild(el('h3', 'text-xl font-semibold', copy.title));
    empty.appendChild(
      el('p', `mt-2 text-sm ${dark ? 'text-[#aab6c5]' : 'text-[#586678]'}`, copy.body),
    );
    shell.appendChild(empty);
  } else if (!filtersActive() && !revealed && viewTab === 'discover') {
    const curated = el('section', 'grid grid-cols-1 gap-4 sm:grid-cols-3');
    const hero = items[0];
    if (hero) curated.appendChild(renderCard(hero, { size: 'hero', index: 0 }));
    for (let i = 1; i < Math.min(items.length, HERO_COUNT + SECONDARY_COUNT); i += 1) {
      curated.appendChild(renderCard(items[i]!, { size: 'card', index: i }));
    }
    shell.appendChild(curated);

    if (items.length > 0) {
      const reveal = el(
        'div',
        'mt-6 flex flex-col items-center gap-2',
      );
      const button = el(
        'button',
        'min-h-11 rounded-full border px-5 text-sm font-medium transition',
        'Show more from your archive',
      );
      button.type = 'button';
      button.style.borderColor = accent;
      button.style.color = accent;
      button.style.background = `${accent}10`;
      button.addEventListener('click', () => {
        revealed = true;
        loadMore();
      });
      reveal.appendChild(button);
      reveal.appendChild(
        el(
          'p',
          `text-xs ${dark ? 'text-[#7f8da0]' : 'text-[#586678]'}`,
          'Or just refresh the new tab for a different pick.',
        ),
      );
      shell.appendChild(reveal);
    }
  } else {
    const grid = el('div', 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3');
    items.forEach((bookmark, index) => grid.appendChild(renderCard(bookmark, { size: 'card', index })));
    shell.appendChild(grid);
    sentinel = el('div', 'h-12');
    shell.appendChild(sentinel);
    if (exhausted) {
      shell.appendChild(
        el(
          'p',
          `mt-4 rounded-xl border px-4 py-3 text-center text-sm ${dark ? 'border-[#263241] bg-[#101923] text-[#aab6c5]' : 'border-[#dbe1ea] bg-white text-[#475569]'}`,
          'You have seen everything in your feed this session. Open a new tab to start over.',
        ),
      );
    }
  }

  const help = renderHelp(helpOpen);
  if (help) shell.appendChild(help);
  const tagEditor = renderTagEditor(editingTags);
  if (tagEditor) shell.appendChild(tagEditor);
  const folderUi = renderFolderPrompt();
  if (folderUi) shell.appendChild(folderUi);
  const folderPickUi = renderFolderPicker();
  if (folderPickUi) shell.appendChild(folderPickUi);
  const deleteUi = renderDeleteConfirm();
  if (deleteUi) shell.appendChild(deleteUi);

  if (toastMessage) {
    const toast = el(
      'div',
      'pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#0f1825]/95 px-4 py-2 text-sm text-white shadow-2xl',
      toastMessage,
    );
    shell.appendChild(toast);
  }
  main.appendChild(shell);
  appRoot.replaceChildren(main);
  attachTagMenu();
  if (!filtersActive() && revealed) observeSentinel();
}

let observer: IntersectionObserver | null = null;

function observeSentinel(): void {
  observer?.disconnect();
  if (!sentinel) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    },
    { rootMargin: '600px' },
  );
  observer.observe(sentinel);
}

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return;
  }
  if (event.altKey) return;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    // Allow Enter with Cmd/Ctrl modifiers to open in new tab
  } else if (event.metaKey || event.ctrlKey) {
    return;
  }
  if (event.key === 'Escape') {
    if (tagMenuOpen) {
      tagMenuOpen = false;
      render();
      return;
    }
    if (helpOpen) {
      helpOpen = false;
      render();
      return;
    }
  }
  if (event.key === 'j') {
    event.preventDefault();
    focusIndex = Math.min(Math.max(items.length - 1, 0), focusIndex + 1);
    render();
  } else if (event.key === 'k') {
    event.preventDefault();
    focusIndex = Math.max(0, focusIndex - 1);
    render();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const bookmark = items[focusIndex];
    if (bookmark) openBookmark(bookmark, { newTab: event.metaKey || event.ctrlKey });
  } else if (event.key === 'm') {
    if (viewTab !== 'reading' && viewTab !== 'done') return;
    event.preventDefault();
    const bookmark = items[focusIndex];
    if (bookmark) void consumeBookmark(bookmark);
  } else if (event.key === '?') {
    event.preventDefault();
    helpOpen = !helpOpen;
    render();
  }
});

document.documentElement.style.colorScheme = theme;
applyAccent();
window.addEventListener('storage', syncThemeFromStorage);
await fetchPool();
loadMore();
render();
requestBackgroundSync();
scheduleEnrichmentPolling();
