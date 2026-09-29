import type { MockExamSession } from "@xuetu/contracts";

export interface MockExamDraft {
  choices: Record<string, string[]>;
  subjective: Record<string, string>;
  activeIndex: number;
  submissionKey: string | null;
}

const storageKey = (owner: string) => `xuetu.mock-exam-draft.v1:${encodeURIComponent(owner)}`;
const emptyDraft = (): MockExamDraft => ({ choices: {}, subjective: {}, activeIndex: 0, submissionKey: null });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function clearMockExamDraft(owner: string) {
  try { window.sessionStorage.removeItem(storageKey(owner)); } catch { /* Storage can be disabled. */ }
}

export function readMockExamDraft(owner: string | null, session: MockExamSession): MockExamDraft {
  const draft = emptyDraft();
  if (!owner) return draft;
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(owner)) ?? "null");
    if (!isRecord(raw) || raw.sessionId !== session.session_id || raw.startedAt !== session.started_at
      || raw.expiresAt !== session.expires_at || session.status !== "active"
      || Date.parse(session.expires_at) <= Date.parse(session.server_now)) {
      clearMockExamDraft(owner);
      return draft;
    }
    for (const { question } of session.questions) {
      if (question.type === "choice" && isRecord(raw.choices)) {
        const selected = raw.choices[question.id];
        if (Array.isArray(selected)) {
          const valid = question.options.filter(option => selected.includes(option.option_id)).map(option => option.option_id);
          draft.choices[question.id] = question.multiple ? valid : valid.slice(0, 1);
        }
      } else if (question.type === "subjective" && isRecord(raw.subjective)) {
        const response = raw.subjective[question.id];
        if (typeof response === "string") draft.subjective[question.id] = response;
      }
    }
    if (typeof raw.activeIndex === "number" && Number.isInteger(raw.activeIndex)
      && raw.activeIndex >= 0 && raw.activeIndex < session.questions.length) draft.activeIndex = raw.activeIndex;
    if (typeof raw.submissionKey === "string" && /^mock-exam-submit-[a-z0-9-]{1,100}$/i.test(raw.submissionKey)) {
      draft.submissionKey = raw.submissionKey;
    }
  } catch { clearMockExamDraft(owner); }
  return draft;
}

export function saveMockExamDraft(owner: string | null, session: MockExamSession, draft: MockExamDraft): boolean {
  if (!owner) return false;
  try {
    window.sessionStorage.setItem(storageKey(owner), JSON.stringify({
      sessionId: session.session_id, startedAt: session.started_at, expiresAt: session.expires_at, ...draft,
    }));
    return true;
  } catch {
    // Remove an older copy so a later reload cannot silently restore stale answers.
    clearMockExamDraft(owner);
    return false;
  }
}
