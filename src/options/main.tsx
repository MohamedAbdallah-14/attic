import '../styles/tailwind.css';
import type { MessageResponse, RuntimeMessage } from '../shared/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ThemePreference = 'system' | 'dark' | 'light' | 'attic';
type CaptureMode = 'ask' | 'reading' | 'bookmarks';
type DeleteScope = 'ask' | 'attic' | 'both';

interface Stats {
  bookmarks: number;
  reading: number;
  done: number;
}

interface EnrichmentStatus {
  pending: number;
  ok: number;
  failed: number;
}

interface ImageCacheStats {
  count: number;
  bytes: number;
}

interface LocalActivity {
  capturesWeek: number;
  doneWeek: number;
  shownTotal: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const THEME_KEY = 'attic-theme-preference';
const ACCENT_KEY = 'attic-accent';
const CAPTURE_KEY = 'attic-capture-mode';
const DELETE_KEY = 'attic-delete-scope';
const DEFAULT_ACCENT = '#6f53ff';

const ACCENT_CHOICES: Array<{ label: string; value: string }> = [
  { label: 'Indigo', value: '#6f53ff' },
  { label: 'Emerald', value: '#22c1a0' },
  { label: 'Amber', value: '#f2a93b' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Sky', value: '#38bdf8' },
];

let themePreference: ThemePreference = readThemePref();
let accent: string = localStorage.getItem(ACCENT_KEY) ?? DEFAULT_ACCENT;
let captureMode: CaptureMode = readCapturePref();
let deleteScope: DeleteScope = readDeletePref();

let stats: Stats | null = null;
let enrichment: EnrichmentStatus | null = null;
let imageCache: ImageCacheStats | null = null;
let activity: LocalActivity | null = null;

let confirmClear = false;
let toastMessage = '';
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readThemePref(): ThemePreference {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'dark' || v === 'light' || v === 'attic' ? v : 'system';
}

function readCapturePref(): CaptureMode {
  const v = localStorage.getItem(CAPTURE_KEY);
  return v === 'reading' || v === 'bookmarks' ? v : 'ask';
}

function readDeletePref(): DeleteScope {
  const v = localStorage.getItem(DELETE_KEY);
  return v === 'attic' || v === 'both' ? v : 'ask';
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

async function send<T = unknown>(msg: RuntimeMessage): Promise<MessageResponse<T>> {
  return (await chrome.runtime.sendMessage(msg)) as MessageResponse<T>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function flashToast(msg: string): void {
  toastMessage = msg;
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage = '';
    render();
  }, 2500);
  render();
}

// ─── Preference setters ───────────────────────────────────────────────────────

function setThemePref(next: ThemePreference): void {
  themePreference = next;
  if (next === 'system') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, next);
  render();
}

function setAccent(next: string): void {
  accent = next;
  localStorage.setItem(ACCENT_KEY, next);
  render();
}

async function setCaptureMode(next: CaptureMode): Promise<void> {
  captureMode = next;
  localStorage.setItem(CAPTURE_KEY, next);
  render();
  // The service worker reads `chrome.storage.local.atticCaptureMode` on every
  // shortcut/context-menu fire; if this write fails, the UI and the SW disagree.
  try {
    await chrome.storage.local.set({ atticCaptureMode: next });
  } catch (error) {
    console.warn('[attic] failed to write atticCaptureMode to chrome.storage.local', error);
  }
}

async function hydrateCaptureModeFromChromeStorage(): Promise<void> {
  // The service worker is the source of truth for atticCaptureMode. If the
  // user cleared localStorage or wrote to chrome.storage.local from elsewhere,
  // we'd otherwise show a stale value. Read from chrome.storage on boot and
  // re-mirror into localStorage if it diverges.
  try {
    const result = await chrome.storage.local.get('atticCaptureMode');
    const live = result.atticCaptureMode;
    if (live === 'ask' || live === 'reading' || live === 'bookmarks') {
      if (live !== captureMode) {
        captureMode = live;
        localStorage.setItem(CAPTURE_KEY, live);
        render();
      }
    }
  } catch {
    /* chrome.storage unavailable in test env — ignore */
  }
}

function setDeleteScope(next: DeleteScope): void {
  deleteScope = next;
  if (next === 'ask') localStorage.removeItem(DELETE_KEY);
  else localStorage.setItem(DELETE_KEY, next);
  render();
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadStats(): Promise<void> {
  const [statsRes, enrichRes, cacheRes, activityRes] = await Promise.all([
    send<Stats>({ type: 'popup-stats' }),
    send<EnrichmentStatus>({ type: 'enrichment-status' }),
    send<ImageCacheStats>({ type: 'image-cache-stats' }),
    send<LocalActivity>({ type: 'local-activity' }),
  ]);
  if (statsRes.ok) stats = statsRes.data;
  if (enrichRes.ok) enrichment = enrichRes.data;
  if (cacheRes.ok) imageCache = cacheRes.data;
  if (activityRes.ok) activity = activityRes.data;
  render();
}

async function reloadStats(): Promise<void> {
  await loadStats();
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function doRerunEnrichment(): Promise<void> {
  const res = await send<{ reset: number }>({ type: 'rerun-failed-enrichment' });
  if (res.ok) flashToast(`Reset ${res.data.reset} failed items`);
  else flashToast('Failed to reset enrichment');
}

async function doResync(): Promise<void> {
  const res = await send<{ inserted: number }>({ type: 'resync-bookmarks' });
  if (res.ok) {
    flashToast(`Synced — ${res.data.inserted} new bookmarks`);
    void reloadStats();
  } else {
    flashToast('Sync failed');
  }
}

async function doExport(): Promise<void> {
  const res = await send<{ bookmarks: unknown[]; exportedAt: number }>({ type: 'export-data' });
  if (!res.ok) {
    flashToast('Export failed');
    return;
  }
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attic-export-${new Date(res.data.exportedAt).toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flashToast('Export downloaded');
}

async function doClearAll(): Promise<void> {
  confirmClear = false;
  const res = await send({ type: 'clear-all' });
  if (res.ok) {
    stats = null;
    enrichment = null;
    imageCache = null;
    activity = null;
    flashToast('All data deleted');
    void reloadStats();
  } else {
    flashToast('Clear failed');
  }
}

// ─── Render sections ──────────────────────────────────────────────────────────

function pill(
  label: string,
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = el('button', 'rounded-full border px-3 py-1.5 text-sm font-medium transition', label);
  btn.type = 'button';
  if (active) {
    btn.style.background = accent;
    btn.style.borderColor = accent;
    btn.style.color = '#ffffff';
  } else {
    btn.style.background = '#0d1623';
    btn.style.borderColor = '#27344a';
    btn.style.color = '#dce6f5';
  }
  btn.addEventListener('click', onClick);
  return btn;
}

function section(title: string): HTMLElement {
  const wrap = el('section', 'mb-8');
  const h = el('h2', 'mb-3 text-base font-semibold text-[#f4f7fb]', title);
  wrap.appendChild(h);
  return wrap;
}

function labelRow(label: string): HTMLElement {
  const row = el('div', 'mb-2 flex flex-wrap items-center gap-2');
  row.appendChild(el('span', 'w-28 text-xs uppercase tracking-wide text-[#7f8da0]', label));
  return row;
}

function renderThemeSection(): HTMLElement {
  const sec = section('Theme');

  const modeRow = labelRow('Mode');
  for (const [label, value] of [
    ['System', 'system'],
    ['Dark', 'dark'],
    ['Light', 'light'],
    ['Attic', 'attic'],
  ] as const) {
    modeRow.appendChild(pill(label, themePreference === value, () => setThemePref(value)));
  }
  sec.appendChild(modeRow);

  const accentRow = labelRow('Accent');
  for (const choice of ACCENT_CHOICES) {
    const swatch = el('button', 'size-7 rounded-full border-2 transition');
    swatch.type = 'button';
    swatch.style.background = choice.value;
    swatch.style.borderColor = accent === choice.value ? '#ffffff' : 'rgba(0,0,0,0.12)';
    swatch.style.boxShadow = accent === choice.value ? `0 0 0 2px ${choice.value}` : 'none';
    swatch.ariaLabel = `Accent ${choice.label}`;
    swatch.title = choice.label;
    swatch.addEventListener('click', () => setAccent(choice.value));
    accentRow.appendChild(swatch);
  }
  sec.appendChild(accentRow);

  return sec;
}

function renderCaptureSection(): HTMLElement {
  const sec = section('Capture defaults');
  sec.appendChild(
    el('p', 'mb-3 text-xs text-[#7f8da0]', 'Where new captures go when saved via keyboard shortcut or context menu.'),
  );
  const row = el('div', 'flex flex-wrap gap-2');
  row.appendChild(pill('Ask each time', captureMode === 'ask', () => setCaptureMode('ask')));
  row.appendChild(pill('Reading list', captureMode === 'reading', () => setCaptureMode('reading')));
  row.appendChild(pill('Bookmarks', captureMode === 'bookmarks', () => setCaptureMode('bookmarks')));
  sec.appendChild(row);
  return sec;
}

function renderDeleteSection(): HTMLElement {
  const sec = section('Delete preference');
  sec.appendChild(
    el('p', 'mb-3 text-xs text-[#7f8da0]', 'What happens when you delete a bookmark from Attic.'),
  );
  const row = el('div', 'flex flex-wrap gap-2');
  row.appendChild(pill('Ask each time', deleteScope === 'ask', () => setDeleteScope('ask')));
  row.appendChild(pill('Attic only', deleteScope === 'attic', () => setDeleteScope('attic')));
  row.appendChild(pill('Attic and Chrome', deleteScope === 'both', () => setDeleteScope('both')));
  sec.appendChild(row);
  return sec;
}

function renderDataUsageSection(): HTMLElement {
  const sec = section('Data usage');

  const grid = el('div', 'grid grid-cols-2 gap-3 sm:grid-cols-3');

  const items: Array<{ label: string; value: string }> = [
    { label: 'Bookmarks total', value: stats ? String(stats.bookmarks) : '—' },
    { label: 'On reading list', value: stats ? String(stats.reading) : '—' },
    { label: 'Done', value: stats ? String(stats.done) : '—' },
    { label: 'Image cache', value: imageCache ? `${imageCache.count} · ${formatBytes(imageCache.bytes)}` : '—' },
    { label: 'Enrichment pending', value: enrichment ? String(enrichment.pending) : '—' },
    { label: 'Enrichment ok', value: enrichment ? String(enrichment.ok) : '—' },
    { label: 'Enrichment failed', value: enrichment ? String(enrichment.failed) : '—' },
  ];

  for (const item of items) {
    const tile = el('div', 'rounded-xl border border-[#1e2d3f] bg-[#0d1623] px-3 py-3');
    tile.appendChild(el('p', 'text-lg font-bold text-[#f4f7fb]', item.value));
    tile.appendChild(el('p', 'mt-1 text-xs text-[#7f8da0]', item.label));
    grid.appendChild(tile);
  }

  sec.appendChild(grid);
  return sec;
}

function renderActivitySection(): HTMLElement {
  const sec = section('Local activity');
  sec.appendChild(
    el('p', 'mb-3 text-xs text-[#7f8da0]', 'All local, no telemetry.'),
  );

  const grid = el('div', 'grid grid-cols-3 gap-3');
  const items: Array<{ label: string; value: string }> = [
    { label: 'Captures (7d)', value: activity ? String(activity.capturesWeek) : '—' },
    { label: 'Done (7d)', value: activity ? String(activity.doneWeek) : '—' },
    { label: 'Shown total', value: activity ? String(activity.shownTotal) : '—' },
  ];

  for (const item of items) {
    const tile = el('div', 'rounded-xl border border-[#1e2d3f] bg-[#0d1623] px-3 py-3');
    tile.appendChild(el('p', 'text-lg font-bold text-[#f4f7fb]', item.value));
    tile.appendChild(el('p', 'mt-1 text-xs text-[#7f8da0]', item.label));
    grid.appendChild(tile);
  }

  sec.appendChild(grid);
  return sec;
}

function renderManageDataSection(): HTMLElement {
  const sec = section('Manage data');

  const btnClass =
    'rounded-xl border border-[#27344a] bg-[#0d1623] px-4 py-2.5 text-sm font-medium text-[#dce6f5] hover:bg-[#1a2536] transition';

  const row = el('div', 'flex flex-wrap gap-3');

  const rerun = el('button', btnClass, 'Re-run failed enrichment');
  rerun.type = 'button';
  rerun.addEventListener('click', () => void doRerunEnrichment());
  row.appendChild(rerun);

  const resync = el('button', btnClass, 'Re-sync Chrome bookmarks');
  resync.type = 'button';
  resync.addEventListener('click', () => void doResync());
  row.appendChild(resync);

  const exportBtn = el('button', btnClass, 'Export bookmarks as JSON');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', () => void doExport());
  row.appendChild(exportBtn);

  sec.appendChild(row);
  return sec;
}

function renderDangerSection(): HTMLElement {
  const sec = section('Danger zone');

  if (confirmClear) {
    const box = el('div', 'rounded-xl border border-red-700/50 bg-red-950/30 p-4');
    box.appendChild(el('p', 'mb-3 text-sm text-red-300', 'This wipes every saved bookmark and all cached images. Cannot be undone.'));
    const btnRow = el('div', 'flex gap-3');

    const cancelBtn = el('button', 'rounded-xl border border-[#27344a] px-4 py-2 text-sm text-[#7f8da0] hover:text-white transition', 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      confirmClear = false;
      render();
    });
    btnRow.appendChild(cancelBtn);

    const confirmBtn = el('button', 'rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition', 'Delete everything');
    confirmBtn.type = 'button';
    confirmBtn.addEventListener('click', () => void doClearAll());
    btnRow.appendChild(confirmBtn);

    box.appendChild(btnRow);
    sec.appendChild(box);
  } else {
    const deleteBtn = el('button', 'rounded-xl border border-red-700/50 bg-transparent px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition', 'Delete all local data');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => {
      confirmClear = true;
      render();
    });
    sec.appendChild(deleteBtn);
  }

  return sec;
}

// ─── Root render ──────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById('options-root');
  if (!root) return;

  const page = el('div', 'mx-auto max-w-[720px] px-6 py-10');

  // Header
  const header = el('div', 'mb-8 flex items-center gap-3');
  const mark = el('div', 'grid size-9 place-items-center rounded-lg text-base font-bold text-white', 'A');
  mark.style.background = accent;
  header.appendChild(mark);
  header.appendChild(el('h1', 'text-xl font-semibold tracking-tight text-[#f4f7fb]', 'Attic settings'));
  page.appendChild(header);

  // Toast
  if (toastMessage) {
    const toast = el('div', 'mb-6 rounded-xl border border-[#27344a] bg-[#0d1623] px-4 py-2.5 text-sm text-[#dce6f5]', toastMessage);
    page.appendChild(toast);
  }

  // Divider helper
  const divider = () => el('div', 'mb-8 border-t border-[#1e2d3f]');

  page.appendChild(renderThemeSection());
  page.appendChild(divider());
  page.appendChild(renderCaptureSection());
  page.appendChild(divider());
  page.appendChild(renderDeleteSection());
  page.appendChild(divider());
  page.appendChild(renderDataUsageSection());
  page.appendChild(divider());
  page.appendChild(renderActivitySection());
  page.appendChild(divider());
  page.appendChild(renderManageDataSection());
  page.appendChild(divider());
  page.appendChild(renderDangerSection());

  root.replaceChildren(page);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

render();
void hydrateCaptureModeFromChromeStorage();
void loadStats();
