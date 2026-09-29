import type {
  MemoryCard,
  MemoryCardSeed,
  MemoryCardWrite,
  MemoryReview,
  MemoryReviewResult,
  MemoryToday,
  StudyCollection,
  StudyCollectionDetail,
  StudyCollectionWrite,
  StudyMap,
  StudyMapQuery,
} from "@xuetu/contracts";
import { request } from "../../api/client";
const root = "/api/v1/student/study-library";
const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});
export const studyLibraryApi = {
  map: (query: Partial<StudyMapQuery>, signal?: AbortSignal) =>
    request<StudyMap>(
      `${root}/map?${new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      )}`,
      signal ? { signal } : {},
    ),
  collections: (signal?: AbortSignal) =>
    request<{ items: StudyCollection[] }>(
      `${root}/collections`,
      signal ? { signal } : {},
    ),
  collection: (id: string, signal?: AbortSignal) =>
    request<StudyCollectionDetail>(
      `${root}/collections/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    ),
  saveCollection: (id: string, input: StudyCollectionWrite) =>
    request<{ collection: StudyCollection }>(
      `${root}/collections/${encodeURIComponent(id)}`,
      json("PUT", input),
    ),
  removeCollection: (id: string, version: number) =>
    request(
      `${root}/collections/${encodeURIComponent(id)}?version=${version}`,
      { method: "DELETE" },
    ),
  memberships: (id: string, signal?: AbortSignal) =>
    request<{ ids: string[] }>(
      `${root}/questions/${encodeURIComponent(id)}/collections`,
      signal ? { signal } : {},
    ),
  setMembership: (id: string, qid: string, included: boolean) =>
    request(
      `${root}/collections/${encodeURIComponent(id)}/questions/${encodeURIComponent(qid)}`,
      { method: included ? "PUT" : "DELETE" },
    ),
  cards: (signal?: AbortSignal) =>
    request<{ items: MemoryCard[] }>(`${root}/cards`, signal ? { signal } : {}),
  cardSeeds: (signal?: AbortSignal) =>
    request<{ items: MemoryCardSeed[] }>(
      `${root}/card-seeds`,
      signal ? { signal } : {},
    ),
  saveCard: (id: string, input: MemoryCardWrite) =>
    request<{ card: MemoryCard }>(
      `${root}/cards/${encodeURIComponent(id)}`,
      json("PUT", input),
    ),
  removeCard: (id: string, version: number) =>
    request(`${root}/cards/${encodeURIComponent(id)}?version=${version}`, {
      method: "DELETE",
    }),
  today: () => request<MemoryToday>(`${root}/today`),
  startDay: () => request<MemoryToday>(`${root}/today`, { method: "POST" }),
  review: (input: MemoryReview) =>
    request<MemoryReviewResult>(`${root}/reviews`, json("POST", input)),
};
