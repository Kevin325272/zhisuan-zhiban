const STORAGE_PREFIX = "xuetu.admissions-search-history.v1";
const MAX_HISTORY_ITEMS = 6;

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}`;
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const query = item.trim();
    if (!query || unique.has(query)) continue;
    unique.add(query);
    if (unique.size === MAX_HISTORY_ITEMS) break;
  }
  return [...unique];
}

export function loadAdmissionsSearchHistory(userId: string) {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? normalizeHistory(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function rememberAdmissionsSearch(userId: string, value: string) {
  const query = value.trim();
  if (!query) return loadAdmissionsSearchHistory(userId);
  const next = [
    query,
    ...loadAdmissionsSearchHistory(userId).filter((item) => item !== query),
  ].slice(0, MAX_HISTORY_ITEMS);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Search remains usable when local storage is unavailable.
  }
  return next;
}

export function clearAdmissionsSearchHistory(userId: string) {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Clearing local convenience data must not block admissions search.
  }
}
