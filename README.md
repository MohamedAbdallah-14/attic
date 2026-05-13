<div align="center">

<img src="docs/brand/brandmark.png" width="96" alt="Attic"/>

# Attic

**Rediscover the links you saved, every time you open a new tab.**

Attic is a Chrome extension that turns the new-tab page into a quiet, randomized feed of bookmarks you already kept. Local-only. No accounts. No telemetry. No cloud.

<img src="docs/brand/hero-readme.jpg" alt="Attic hero" width="100%"/>

[![Build](https://img.shields.io/badge/build-passing-2ea44f)](https://github.com/MohamedAbdallah-14/attic/actions)
[![Coverage](https://img.shields.io/badge/coverage-≥89%25-2ea44f)](https://github.com/MohamedAbdallah-14/attic)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](#install-from-source)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](#install-from-source)
[![Local-first](https://img.shields.io/badge/local--first-✓-7c3aed)](#privacy)
[![License](https://img.shields.io/badge/license-BSL%201.1%20to%20Apache%202.0-111827)](LICENSE)

</div>

---

## The problem

Bookmarks are not the problem. Forgetting they exist is the problem.

A useful project gets mentioned in a YouTube description. A friend sends a long-form article. You save it. You never see it again.

Attic makes the idle new-tab moment useful. Open a new tab, see something you already decided was worth keeping.

## What it does

| | |
|---|---|
| <img src="docs/brand/feature-discover.jpg" alt="Rediscovery feed" width="240"/> | **Rediscovery feed.** The new tab is a weighted-random pick from your saved bookmarks. Recent items boosted. Repeatedly shown items down-weighted. Items you mark done get zero weight. |
| <img src="docs/brand/feature-bookmarks.jpg" alt="Bookmark manager" width="240"/> | **Bookmark manager.** Every saved link in one tab. Inline icons per card: edit tags, move to a Chrome folder, delete, star. Tag edits attempt to move the bookmark into the matching Chrome folder; no match offers to create one. |
| <img src="docs/brand/feature-reading.jpg" alt="Reading list + Done" width="240"/> | **Reading list + Done.** A distinct one-time-read pile. Items captured via Attic surfaces auto-join. Plain Chrome bookmarks don't. A star toggles membership. Mark done sends to Done. Undo done returns. |
| <img src="docs/brand/feature-capture.jpg" alt="Capture everywhere" width="240"/> | **Capture everywhere.** Save from the toolbar popup, the `Cmd/Ctrl+Shift+S` shortcut, the right-click menu, or Pocket HTML import. Chrome bookmarks sync in automatically. |

## How you save things

Five capture surfaces, in order of how often you'll use them:

1. **Toolbar popup** — segmented control picks Reading list or Bookmarks, then save.
2. **Keyboard shortcut** — `Cmd/Ctrl+Shift+S`.
3. **Right-click context menu** — Save page or Save link.
4. **Chrome bookmarks sync** — your existing Chrome bookmarks appear automatically, no manual import.
5. **Pocket HTML import** — drop in your `ril_export.html`.

The shortcut and context menu honor your `attic-capture-mode` preference: **Ask each time** (fires a Chrome notification with two buttons), **Reading list**, or **Bookmarks**.

> Per-site capture buttons on YouTube, X, Facebook, TikTok, Instagram, and GitHub were shipped in 1.0.0 and removed in 1.0.1 pending a continuous live-DOM verification harness.

## Install from source

**Requires** Node `>=22`, pnpm `9.15.x`, and Chrome (or Chrome for Testing).

```sh
pnpm install
pnpm build
```

Then load it:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Pick the `dist/` folder.

Open a new tab. If you already had Chrome bookmarks, Attic will surface them. If you didn't, save the page you're on with `Cmd/Ctrl+Shift+S` and watch the new tab populate.

## Privacy

Attic is **local-first by design**. Saved URLs, titles, descriptions, images, and tags live in your browser's IndexedDB.

- No account.
- No telemetry.
- No analytics.
- No cloud sync.
- No "phone home" on install.

The extension's only outbound network requests are metadata fetches to **the URLs you saved**, used to extract titles, descriptions, Open Graph images, favicons, and a capped text snapshot. Images are fetched once and cached as Blobs so your feed survives offline.

Full privacy copy: [`docs/privacy.html`](https://mohamedabdallah-14.github.io/attic/privacy.html).

## How it's built

```text
src/
  manifest.ts                 MV3 manifest typed through @crxjs/vite-plugin
  background/
    index.ts                  service-worker entrypoint
    bookmarks-sync.ts         Chrome bookmark tree walker + listeners
    enrichment.ts             metadata fetch queue + image blob cache write
    folders.ts                Chrome folder index, create, move, remove
    handlers.ts               message dispatch (capture, sync, tags, delete, etc.)
    og-parser.ts              regex Open Graph parser — no DOMParser in MV3 SW
    readable.ts               text snapshot extractor
  newtab/
    main.tsx                  the new-tab UI: tab bar, cards, dialogs
    feed.ts                   weighted random selection (consumedAt → weight 0)
    library.ts                search, tag/source/consumed/reading-list filters
  popup/
    main.tsx                  toolbar popup with destination toggle + picker
  options/
    main.tsx                  settings page (theme, capture, delete, data, danger zone)
  storage/
    db.ts                     IndexedDB v3: bookmarks + images stores + chromeId index
    bookmarks.ts              upsertByHash, reading-list helpers, hardDelete
    images.ts                 og:image Blob cache (2 MB cap, content-type guarded)
    importers/pocket-html.ts  Netscape bookmark parser
  shared/
    auto-tags.ts              host-based + folder-path-based tag derivation
    backoff.ts                enrichment retry policy
    types.ts                  shared Bookmark, RuntimeMessage, CapturePayload
    url.ts                    URL normalization + hashing
```

Vanilla TypeScript. Tailwind v4. No React runtime, no IndexedDB wrapper library, no global state container.

## Data model

IndexedDB database `attic`, schema version 3.

**Bookmarks store** — one row per saved link:

| Field | Notes |
|---|---|
| `urlHash` | normalized SHA-256 hash; primary lookup |
| `url`, `title`, `description`, `imageUrl`, `faviconUrl`, `siteName` | enrichment output |
| `chromeId` | matching Chrome bookmark node id when applicable (indexed) |
| `source` | `chrome-bookmarks` \| `manual` \| `shortcut` \| `context-menu` \| `site:<platform>` \| `pocket-import` |
| `capturedAt`, `shownCount`, `lastShownAt` | feed-weighting inputs |
| `consumedAt` | non-null = Done; weight zero |
| `readingListAt` | non-null = on reading list |
| `tags` | derived from URL host, Chrome folder path, and user input |
| `snapshotText` | capped at 4,000 chars |
| `enrichment`, `enrichmentAttempts` | enrichment lifecycle |

**Images store** (`urlHash`-keyed): `{ blob, contentType, byteSize, fetchedAt }`. Populated by the service worker; consumed by the newtab via object URLs.

**Reading-list rule.** Captures from Attic surfaces (`manual`, `shortcut`, `context-menu`, `pocket-import`) auto-set `readingListAt` on upsert. `chrome-bookmarks` does not. Ask-mode captures pass an explicit `readingListAt: null` so the row stays in Bookmarks until the notification choice resolves.

**Feed weighting.** `weight = 1 / sqrt(shownCount + 1) × recencyBoost × (consumedAt ? 0 : 1)`.

## Development

```sh
pnpm dev           # Vite dev server
pnpm typecheck     # strict TS project check
pnpm test          # Vitest (187 tests, runs in ~2 s)
pnpm test:coverage # ≥89 % branches; ≥90 % statements/functions/lines
pnpm build         # typecheck + production MV3 build
```

Architectural hubs that carry the load — `upsertByHash`, `patch`, `withBookmarksStore`, the `on(...)` message handlers, and the newtab `render()` loop — all have dedicated tests.

## Status

Current: 1.0.1. Chrome MV3, local IndexedDB, five capture surfaces (popup, `Cmd/Ctrl+Shift+S` shortcut, right-click menu, Chrome bookmarks sync, Pocket HTML import), metadata enrichment, 90 % coverage gate.

Cut by design: cloud sync, accounts, mobile apps, multi-account, telemetry, paid plans.

## License

Attic is licensed under the [Business Source License 1.1](LICENSE). The license
allows production use for anyone except competing products, and converts to the
Apache License 2.0 on 2030-05-13.

---

<div align="center">

Built quietly. Stored locally. Surfaces only what you saved.

</div>
