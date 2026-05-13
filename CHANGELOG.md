# Changelog

All notable changes to Attic are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses semantic versioning before Chrome Web Store submission.

## [1.0.1] - 2026-05-12

Pre-publish trim. The per-site capture button injection on YouTube, X, Facebook, TikTok, Instagram, and GitHub is removed. Capture still works through the toolbar popup, the `Cmd/Ctrl+Shift+S` shortcut, the right-click context menu, Chrome bookmarks sync, and Pocket import.

### Removed

- Content-script injection on all six host sites. The whole `src/content/` tree (`sites/*` adapters, the Shadow DOM picker, the orchestrator + WeakRef cache, the platform-discovery message protocol) is deleted.
- `manifest.json` no longer declares `content_scripts`. Same `host_permissions: <all_urls>` is kept for background metadata enrichment.
- Popup platform-discovery flow (`hydratePlatformDiscovery`, `savePlatformSelection`, the per-site picker UI) is gone. Popup is now just the current-tab save card + stats + More actions.
- `docs/qa/site-adapter-matrix.md` deleted.

### Why

Live-DOM smoke testing on FB Reels, YT Shorts, TikTok FYP, IG, X, and GitHub couldn't be automated without a Chrome-with-extension Playwright harness, and the jsdom unit tests only cover the rail-discovery logic, not the actual host-page behavior. Shipping a feature whose 60+ FB locale variants and SPA-rewrite races we can't continuously verify is a worse user experience than not shipping it. Will return after the v1.1 Playwright harness lands.

## [1.0.0] - 2026-05-12

First Chrome Web Store release. Local-only rediscovery feed, bookmark manager, reading list, and per-site capture across YouTube, X, Facebook, TikTok, Instagram, and GitHub.

### Added

- Reels-mode capture buttons for YouTube Shorts (`/shorts/<id>`), Facebook Reels (`/reel/<id>`), and Instagram Reels (`/reel(s)/<id>`). Each renders a vertical rail-style button matching the platform's native side-rail geometry.
- GitHub adapter: pill button appended into the repo header action group (Sponsor / Watch / Fork / Star) on `github.com/<owner>/<repo>` and its subpages (`/issues`, `/pulls`, `/blob/...`). Reserved routes (`/settings`, `/orgs`, `/marketplace`, etc.) skip injection.
- `findRailContainer` helper in `src/content/sites/_button.ts` for rail discovery: walks up from an anchor element until a parent has N sibling buttons.
- `findRailViaVideo` fallback in the Facebook adapter for reel pages whose Like aria-label doesn't resolve in any of the catalogued languages.
- Bookmark-add icon glyph (ribbon with a `+`) replaces the Attic house mark on injected buttons so the save semantics are obvious to first-time users. House mark stays in newtab and popup branding.
- SPA navigation re-mount: stale `[data-br-trigger]` elements are removed before re-activating, so navigating `/watch?v=…` → `/shorts/…` rebuilds the button in the new mount target instead of leaving a stranded button behind.
- Chrome bookmarks sync into local IndexedDB.
- Toolbar, keyboard shortcut, context-menu, popup, Pocket import, and per-site capture surfaces.
- Injected capture buttons for YouTube, X, Facebook, TikTok, Instagram, and GitHub.
- Shadow DOM multi-select picker for saving the current page plus links found in platform descriptions/post bodies.
- Background enrichment for title, description, Open Graph image, favicon, and local text snapshot.
- Randomized new-tab feed with weighted surfacing, keyboard navigation, consumed-state handling, search, source filters, tag filters, local tag editing, and theme toggle.
- Image-inspired command-center new-tab layout and matching polished popup.
- Global 90% coverage gate with Vitest coverage over statements, branches, functions, and lines.
- Store listing, privacy policy, QA matrix, roadmap, and Gitflow contribution guidance.
- Hybrid auto-tags that infer website and curated category tags for new and existing saved links.
- Throttled automatic Chrome bookmark maintenance on startup/new-tab without blocking feed rendering.
- Theme settings for System, Dark, Light, and Attic preferences.
- Bookmark manager view: per-card inline icons for edit tags, move to Chrome folder, and delete (replaces the earlier overflow-menu interaction).
- Tag edits attempt a Chrome-folder move; a prompt offers to create the folder when none matches.
- Move-to-folder picker that lists existing Chrome folders with search and selection (replaces an earlier create-only prompt that fired even when the folder existed).
- Done bookmarks are dropped from the discovery feed entirely; visible in the Done tab.
- Reading list as a distinct set from bookmarks. Captures via popup, keyboard shortcut, context-menu, per-site buttons, and Pocket import auto-join the reading list on upsert; Chrome bookmark syncs do not. A star icon on every Discover and Bookmarks card toggles membership. `markReadingList` / `unmarkReadingList` storage helpers and a `toggle-reading-list` background message support the action.
- Discover / Bookmarks / Reading list / Done tab bar. The Bookmarks tab is the manager (no Mark done). The Reading list tab is the only place Mark done is shown. The Done tab archives consumed reading-list items and offers Undo done.
- Delete preference (Ask each time / Attic only / Attic and Chrome) lives in settings, with a one-time confirm dialog that remembers the choice.
- Per-bookmark `chromeId` stored alongside each row; IndexedDB schema bumped to v3 with a non-unique index. Lets the service worker target Chrome folder moves and bookmark deletions against the right node.
- Chrome folder auto-tags. Saving a bookmark inside a folder tags the row with the folder names (system folders Bookmarks Bar / Other / Mobile are skipped). Folder paths are re-derived on `onCreated` / `onMoved`.
- Local Blob image cache (IndexedDB `images` store, 2MB cap, content-type guarded). The og:image is fetched once during enrichment and rendered from an object URL on the new tab so cards survive offline and stop refetching from origin.
- Burst enrichment pass on import/initial sync plus an "Enriching X / Y" banner with a Speed up control.
- Searchable tag dropdown to replace the chip strip; theme picker gains accent color swatches; cards fall back to a hash-derived gradient with favicon when no image is available.
- Cross-source site filter: clicking a site source chip (e.g. `youtube`) surfaces both extension-captured rows and Chrome bookmarks on the same host.

### Fixed

- Removed service-worker dependency on `DOMParser`, which is not available in MV3 background workers.
- Added fallback rendering for broken card images.
- Fixed filtered empty results so search/filter mode shows the library empty state instead of the global empty archive state.
- Updated storage upsert behavior so a later real title can replace a URL-only fallback title.
- Preserved cached enrichment metadata and feed history during routine Chrome bookmark sync.
- Tag filter dropdown sits above card stacking contexts (z-index lift) so it no longer renders behind the grid.
- Move-to-folder action no longer creates empty-titled folders or shows a create-prompt for folders that already exist.

### Changed

- Replaced React and Dexie with vanilla TypeScript and a native IndexedDB wrapper to keep the extension bundle small.
- Updated public documentation to match the implemented Chrome-only, local-first v1 scope and graphify architecture findings.
- Replaced dropdown-heavy feed filters with visible source, tag, and status chips.
