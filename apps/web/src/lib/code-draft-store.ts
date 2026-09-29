import type { ProgrammingLanguage } from "@xuetu/contracts";

/**
 * 代码草稿的浏览器本地持久化：按「任务 → 语言 → 源码」存储，
 * 刷新页面后恢复；localStorage 不可用时静默降级为纯内存行为。
 */

const STORAGE_KEY_PREFIX = "xuetu.code-drafts.v2";
const WRITE_DEBOUNCE_MS = 300;

type DraftsByTask = Record<string, Partial<Record<ProgrammingLanguage, string>>>;

let pendingWrite: ReturnType<typeof setTimeout> | null = null;
let pendingState: DraftsByTask | null = null;
let pendingStorageKey: string | null = null;
let currentOwnerId: string | null = null;

function storageKey() {
  return `${STORAGE_KEY_PREFIX}.${encodeURIComponent(currentOwnerId ?? "anonymous")}`;
}

function readAll(): DraftsByTask {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DraftsByTask;
  } catch {
    return {};
  }
}

function flushWrite() {
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = null;
  if (!pendingState || !pendingStorageKey) return;
  try {
    window.localStorage.setItem(pendingStorageKey, JSON.stringify(pendingState));
  } catch {
    // 隐私模式或配额不足时放弃持久化，不影响正常编辑。
  }
  pendingState = null;
  pendingStorageKey = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushWrite);
}

export function loadCodeDrafts(
  taskId: string,
): Partial<Record<ProgrammingLanguage, string>> {
  return readAll()[taskId] ?? {};
}

export function setCodeDraftOwner(userId: string | null) {
  const nextOwnerId = userId?.trim() || null;
  if (nextOwnerId === currentOwnerId) return;
  flushWrite();
  currentOwnerId = nextOwnerId;
}

export function saveCodeDraft(
  taskId: string,
  language: ProgrammingLanguage,
  source: string,
) {
  const nextStorageKey = storageKey();
  if (pendingStorageKey && pendingStorageKey !== nextStorageKey) flushWrite();
  const all = pendingState ?? readAll();
  const taskDrafts = { ...(all[taskId] ?? {}) };
  taskDrafts[language] = source;
  pendingState = { ...all, [taskId]: taskDrafts };
  pendingStorageKey = nextStorageKey;
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = setTimeout(flushWrite, WRITE_DEBOUNCE_MS);
}

export function clearCodeDrafts(taskId: string) {
  const nextStorageKey = storageKey();
  if (pendingStorageKey && pendingStorageKey !== nextStorageKey) flushWrite();
  const all = pendingState ?? readAll();
  if (!(taskId in all)) return;
  const { [taskId]: _removed, ...rest } = all;
  pendingState = rest;
  pendingStorageKey = nextStorageKey;
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = setTimeout(flushWrite, WRITE_DEBOUNCE_MS);
}
