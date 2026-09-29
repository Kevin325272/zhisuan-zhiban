import type { StudyQuestion } from "@xuetu/contracts";
const key = (owner: string, query: string) =>
  `xuetu-study-map-queue:${owner}:${query}`;
/** Navigation state only. Every read still resolves questions through the authenticated API. */
export function rememberStudyQueue(
  owner: string,
  query: string,
  questions: StudyQuestion[],
) {
  sessionStorage.setItem(
    key(owner, query),
    JSON.stringify({ ids: questions.map((q) => q.id), createdAt: Date.now() }),
  );
}
export function readStudyQueue(owner: string, query: string): string[] | null {
  try {
    const data = JSON.parse(
      sessionStorage.getItem(key(owner, query)) ?? "null",
    ) as { ids: unknown[]; createdAt: number } | null;
    if (
      !data ||
      !Array.isArray(data.ids) ||
      data.ids.length > 5000 ||
      !data.ids.every((id) => typeof id === "string" && id.length <= 180) ||
      Date.now() - data.createdAt > 86_400_000
    )
      return null;
    return [...new Set(data.ids as string[])];
  } catch {
    return null;
  }
}
