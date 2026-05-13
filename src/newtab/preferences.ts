export type DeleteScopePreference = 'ask' | 'attic' | 'both';

const DELETE_PREF_KEY = 'attic-delete-scope';

export function readDeletePreference(): DeleteScopePreference {
  const value = localStorage.getItem(DELETE_PREF_KEY);
  return value === 'attic' || value === 'both' ? value : 'ask';
}

export function setDeletePreference(preference: DeleteScopePreference): void {
  if (preference === 'ask') {
    localStorage.removeItem(DELETE_PREF_KEY);
    return;
  }
  localStorage.setItem(DELETE_PREF_KEY, preference);
}
