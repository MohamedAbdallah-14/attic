import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Attic',
  description: 'Rediscover the links you saved, every time you open a new tab.',
  version: pkg.version,
  icons: {
    16: 'src/icons/icon-16.png',
    32: 'src/icons/icon-32.png',
    48: 'src/icons/icon-48.png',
    128: 'src/icons/icon-128.png',
  },
  action: {
    default_icon: {
      16: 'src/icons/icon-16.png',
      32: 'src/icons/icon-32.png',
    },
    default_title: 'Attic',
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  chrome_url_overrides: {
    newtab: 'src/newtab/index.html',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  commands: {
    'save-current-page': {
      suggested_key: {
        default: 'Ctrl+Shift+S',
        mac: 'Command+Shift+S',
      },
      description: 'Save the current page to your feed',
    },
  },
  // Permissions are minimal. `scripting` was previously declared but no
  // chrome.scripting.* call site exists — dropped to avoid the
  // "over-permissioned" flag at submission. `tabs` is redundant with
  // `activeTab` for our usage (only the active-tab query path) and was
  // dropped in 1.0.1 for the same reason.
  permissions: [
    'bookmarks',
    'storage',
    'activeTab',
    'contextMenus',
    'alarms',
    'notifications',
    'unlimitedStorage',
  ],
  host_permissions: ['<all_urls>'],
});
