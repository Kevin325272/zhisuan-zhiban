import { z } from "zod";
import { notebookIdSchema, notebookSubjectSchema } from "./student-notebook.js";

export const studyMapQuerySchema = z
  .object({
    source: z.enum(["all", "past_exam", "practice"]).default("all"),
    subject: z.string().max(30).default(""),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    topic: z.string().max(240).default(""),
    search: z.string().trim().max(120).default(""),
    status: z
      .enum(["all", "unseen", "correct", "incorrect", "pending_review"])
      .default("all"),
  })
  .strict();
export type StudyMapQuery = z.infer<typeof studyMapQuerySchema>;
export interface StudyTopic {
  id: string;
  title: string;
  kind?: "concept" | "keyword";
}
export interface StudyQuestion {
  id: string;
  year: number | null;
  number: number;
  subject: string;
  type: "choice" | "subjective";
  source: "past_exam" | "practice";
  excerpt: string;
  topics: StudyTopic[];
  status: "unseen" | "correct" | "incorrect" | "pending_review";
  href: string;
}
export interface StudyMap {
  items: StudyQuestion[];
  total: number;
  attempted: number;
  correct: number;
  years: number[];
  topics: (StudyTopic & { count: number; years: number })[];
}
export const studyCollectionWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type StudyCollectionWrite = z.infer<typeof studyCollectionWriteSchema>;
export interface StudyCollection {
  id: string;
  name: string;
  version: number;
  count: number;
}
export interface StudyCollectionDetail {
  collection: StudyCollection;
  questions: StudyQuestion[];
  unavailable: number;
}

export const memoryCardWriteSchema = z
  .object({
    front: z.string().trim().min(1).max(2000),
    back: z.string().trim().min(1).max(8000),
    subject: notebookSubjectSchema,
    version: z.number().int().nonnegative(),
    source_note_id: notebookIdSchema.nullable().default(null),
  })
  .strict();
export type MemoryCardWrite = z.infer<typeof memoryCardWriteSchema>;
export interface MemoryCard extends Omit<MemoryCardWrite, "version"> {
  id: string;
  version: number;
  due_at: string;
  reviews: number;
}
export const memoryReviewSchema = z
  .object({
    card_id: notebookIdSchema,
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    version: z.number().int().positive(),
    rating: z.enum(["again", "hard", "good", "easy"]),
    request_id: z.string().uuid(),
  })
  .strict();
export type MemoryReview = z.infer<typeof memoryReviewSchema>;
export interface MemoryToday {
  day: string;
  started: boolean;
  total: number;
  completed: number;
  ready: MemoryCard[];
  next_due_at: string | null;
  due_count: number;
}
export interface MemoryReviewResult {
  card: MemoryCard;
  completed: boolean;
}
export interface MemoryCardSeed {
  id: string;
  title: string;
  subject: MemoryCard["subject"];
  front: string;
  back: string;
}
