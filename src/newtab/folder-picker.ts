import type { FolderSummary } from '../shared/types';

export async function listFolders(): Promise<FolderSummary[]> {
  const response = await chrome.runtime.sendMessage({ type: 'list-folders' });
  if (response?.ok) return response.data as FolderSummary[];
  return [];
}

export async function findFolderByTitle(title: string): Promise<FolderSummary | null> {
  const folders = await listFolders();
  const lower = title.trim().toLowerCase();
  return folders.find((folder) => folder.title.toLowerCase() === lower) ?? null;
}

export function topLevelParents(folders: FolderSummary[]): FolderSummary[] {
  return folders.filter((folder) => folder.path.length === 1);
}
