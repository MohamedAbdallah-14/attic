import { initialSync, registerBookmarkListeners } from './bookmarks-sync';
import { kickEnrichment, registerEnrichment } from './enrichment';
import { maybeSyncBookmarks, registerContextMenus, registerHandlers } from './handlers';
import { startMessaging } from './messaging';

registerBookmarkListeners();
startMessaging();
registerHandlers();
registerContextMenus();
registerEnrichment();

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await initialSync();
  }
  void kickEnrichment();
});

chrome.runtime.onStartup.addListener(() => {
  void maybeSyncBookmarks();
});
