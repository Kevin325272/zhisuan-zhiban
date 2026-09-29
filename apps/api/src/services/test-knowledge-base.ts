import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Citation } from "@xuetu/contracts";
import { z } from "zod";

const TEST_KNOWLEDGE_BASE_VERSION = "test_ds_bfs_v1";

const chunkSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  text: z.string().min(1),
  metadata: z.object({
    title: z.string().min(1),
    author: z.string(),
    url: z.string().url(),
    topics: z.array(z.string()),
    quality_score: z.number().min(0).max(1),
  }),
});

const queryCaseSchema = z.object({
  case_id: z.string().min(1),
  scenario: z.enum(["normal", "rag_low_confidence", "rag_empty"]),
  query: z.string().min(1),
  expected_evidence_ids: z.array(z.string()),
  expected_answer_points: z.array(z.string()),
});

const queryCasesSchema = z.object({
  fixture_id: z.string().min(1),
  cases: z.array(queryCaseSchema).min(1),
});

type TestChunk = z.infer<typeof chunkSchema>;
type TestQueryCase = z.infer<typeof queryCaseSchema>;

export type RetrievalMode = "auto" | "normal" | "rag_low_confidence" | "rag_empty";
export type RetrievalScenario = Exclude<RetrievalMode, "auto">;

export interface RetrievedTestChunk {
  sourceId: string;
  documentId: string;
  title: string;
  author: string | null;
  url: string;
  text: string;
  relevance: number;
}

export interface TestRetrievalResult {
  scenario: RetrievalScenario;
  confidenceLevel: "high" | "low";
  caseId: string | null;
  chunks: RetrievedTestChunk[];
  answerPoints: string[];
  summary: string;
}

export interface TestKnowledgeBase {
  retrieve(query: string, mode: RetrievalMode): TestRetrievalResult;
  getCitation(sourceId: string): Citation | undefined;
  listCitations(): Citation[];
}

interface CreateTestKnowledgeBaseOptions {
  fixtureDirectory?: string;
}

function defaultFixtureDirectory() {
  const candidates = [
    resolve(process.cwd(), "data/data-structures/samples"),
    resolve(process.cwd(), "../../data/data-structures/samples"),
    fileURLToPath(new URL("../../../../data/data-structures/samples/", import.meta.url)),
    fileURLToPath(new URL("../../../../../data/data-structures/samples/", import.meta.url)),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error("BFS 测试知识库目录不存在。");
  return match;
}

function readJson<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function readChunks(path: string) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => chunkSchema.parse(JSON.parse(line)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function ngrams(value: string, size = 2) {
  const normalized = normalize(value);
  if (normalized.length <= size) return new Set([normalized]);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function similarity(left: string, right: string) {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft === normalizedRight) return 1;
  const leftGrams = ngrams(normalizedLeft);
  const rightGrams = ngrams(normalizedRight);
  let overlap = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) overlap += 1;
  }
  return (2 * overlap) / Math.max(1, leftGrams.size + rightGrams.size);
}

function clampSnippet(text: string) {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length <= 260 ? compact : `${compact.slice(0, 259)}…`;
}

function toCitation(chunk: TestChunk): Citation {
  return {
    source_id: chunk.id,
    document_id: chunk.document_id,
    title: chunk.metadata.title,
    ...(chunk.metadata.author.trim() ? { author: chunk.metadata.author.trim() } : {}),
    source_type: "test_fixture",
    section: "图与广度优先遍历",
    page: null,
    paragraph: null,
    snippet: clampSnippet(chunk.text),
    relevance: chunk.metadata.quality_score,
    knowledge_base_version: TEST_KNOWLEDGE_BASE_VERSION,
    viewer_url: chunk.metadata.url,
  };
}

function emptyResult(caseId: string | null = null): TestRetrievalResult {
  return {
    scenario: "rag_empty",
    confidenceLevel: "low",
    caseId,
    chunks: [],
    answerPoints: [],
    summary: "测试知识库未找到可引用片段。",
  };
}

export function createTestKnowledgeBase(
  options: CreateTestKnowledgeBaseOptions = {},
): TestKnowledgeBase {
  const fixtureDirectory = options.fixtureDirectory ?? defaultFixtureDirectory();
  const chunks = readChunks(resolve(fixtureDirectory, "bfs-rag-sample.jsonl"));
  const queryCases = readJson(
    resolve(fixtureDirectory, "bfs-query-cases.json"),
    queryCasesSchema,
  ).cases;
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const citationsById = new Map(chunks.map((chunk) => [chunk.id, toCitation(chunk)]));

  function selectCase(query: string, mode: RetrievalMode): TestQueryCase | null {
    if (mode === "rag_empty") return null;
    const candidates =
      mode === "auto" ? queryCases : queryCases.filter((item) => item.scenario === mode);
    const ranked = candidates
      .map((item) => ({ item, score: similarity(query, item.query) }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    return best && best.score >= 0.18 ? best.item : null;
  }

  return {
    retrieve(query, mode) {
      if (mode === "rag_empty") return emptyResult();
      const selected = selectCase(query, mode);
      if (!selected) return emptyResult();
      if (selected.scenario === "rag_empty") return emptyResult(selected.case_id);

      const selectedChunks = selected.expected_evidence_ids
        .slice(0, 2)
        .map((sourceId, index) => {
          const chunk = chunksById.get(sourceId);
          if (!chunk) return null;
          return {
            sourceId: chunk.id,
            documentId: chunk.document_id,
            title: chunk.metadata.title,
            author: chunk.metadata.author.trim() || null,
            url: chunk.metadata.url,
            text: chunk.text,
            relevance: Math.max(0, Math.min(1, 0.96 - index * 0.08)),
          } satisfies RetrievedTestChunk;
        })
        .filter((chunk): chunk is RetrievedTestChunk => chunk !== null);

      if (selectedChunks.length === 0) return emptyResult(selected.case_id);
      const lowConfidence = selected.scenario === "rag_low_confidence";
      return {
        scenario: selected.scenario,
        confidenceLevel: lowConfidence ? "low" : "high",
        caseId: selected.case_id,
        chunks: selectedChunks,
        answerPoints: selected.expected_answer_points,
        summary: lowConfidence
          ? "测试来源匹配度较低，需要结合运行证据核对。"
          : "已命中 BFS 测试知识库中的可追溯片段。",
      };
    },
    getCitation(sourceId) {
      return citationsById.get(sourceId);
    },
    listCitations() {
      return Array.from(citationsById.values());
    },
  };
}
