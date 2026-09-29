import { notebookDraftSchema, type NotebookWrite } from "@xuetu/contracts";

export const NOTEBOOK_ENTRY_CHANGED = "xuetu-notebook-entry-change";

function key(owner: string, id: string) { return `xuetu.notebook-draft.v1:${encodeURIComponent(owner)}:${encodeURIComponent(id)}`; }
export function readNotebookDraft(owner: string, id: string): NotebookWrite | null {
  try {
    const raw = localStorage.getItem(key(owner, id));
    if (!raw) return null;
    const parsed = notebookDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function writeNotebookDraft(owner: string, id: string, draft: NotebookWrite) {
  localStorage.setItem(key(owner, id), JSON.stringify(draft));
  window.dispatchEvent(new Event("xuetu-notebook-draft-change"));
}
export function clearNotebookDraft(owner: string, id: string) {
  localStorage.removeItem(key(owner, id));
  window.dispatchEvent(new Event("xuetu-notebook-draft-change"));
}
/** A completed request may outlive its editor; never remove another tab's newer work. */
export function clearSubmittedNotebookDraft(owner: string, id: string, submitted: NotebookWrite) {
  const current = readNotebookDraft(owner, id);
  if (current && (Object.keys(submitted) as Array<keyof NotebookWrite>).every((field) => current[field] === submitted[field])) {
    clearNotebookDraft(owner, id);
  }
}
export function listNotebookDrafts(owner: string): Array<{ id: string; title: string }> {
  try {
    const prefix = key(owner, ""); const drafts = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const storedKey = localStorage.key(index);
      if (!storedKey?.startsWith(prefix)) continue;
      const id = decodeURIComponent(storedKey.slice(prefix.length));
      const draft = readNotebookDraft(owner, id);
      if (draft) drafts.push({ id, title: draft.title.trim() || "未命名草稿" });
    }
    return drafts;
  } catch { return []; }
}
