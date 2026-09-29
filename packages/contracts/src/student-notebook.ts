import { z } from "zod";

export const notebookIdSchema = z.string().regex(/^[a-zA-Z0-9_.:-]{1,180}$/u);
export const notebookSubjectSchema = z.enum(["通用", "数据结构", "组成原理", "操作系统", "计算机网络"]);
export const notebookWriteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().max(20_000),
  subject: notebookSubjectSchema,
  question_id: notebookIdSchema.nullable(),
  bookmarked: z.boolean(),
  version: z.number().int().min(0),
}).strict().refine((value) => !value.bookmarked || value.question_id !== null, {
  message: "收藏需要关联一道题目。", path: ["question_id"],
});
// An unfinished draft can have an empty title; a server write cannot.
export const notebookDraftSchema = notebookWriteSchema.safeExtend({ title: z.string().max(120) });
export const notebookQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  subject: notebookSubjectSchema.optional(),
  filter: z.enum(["all", "notes", "bookmarks"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
export const notebookQuestionSchema = z.object({
  id: notebookIdSchema,
  year: z.number().int().nullable(),
  number: z.number().int().positive(),
  subject: z.string(),
  type: z.enum(["choice", "subjective"]),
  excerpt: z.string(),
  tags: z.array(z.string()),
  href: z.string().startsWith("/student/practice?"),
}).strict();
export const notebookEntrySchema = z.object({
  id: notebookIdSchema,
  title: z.string(),
  content: z.string(),
  subject: notebookSubjectSchema,
  question_id: notebookIdSchema.nullable(),
  question: notebookQuestionSchema.nullable(),
  bookmarked: z.boolean(),
  version: z.number().int().positive(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export const notebookListSchema = z.object({
  items: z.array(notebookEntrySchema),
  total: z.number().int().nonnegative(),
  notes_count: z.number().int().nonnegative(),
  bookmarks_count: z.number().int().nonnegative(),
}).strict();
export type NotebookWrite = z.infer<typeof notebookWriteSchema>;
export type NotebookQuery = z.infer<typeof notebookQuerySchema>;
export type NotebookEntry = z.infer<typeof notebookEntrySchema>;
export type NotebookQuestion = z.infer<typeof notebookQuestionSchema>;
export type NotebookList = z.infer<typeof notebookListSchema>;

export function questionNotebookId(questionId: string) { return `question:${questionId}`; }
