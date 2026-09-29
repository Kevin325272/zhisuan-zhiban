import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonl, validateCorpus, validateQueryCases } from "./data-tools.mjs";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const datasetDirectory = path.dirname(toolsDirectory);
const load = (...parts) => readFile(path.join(datasetDirectory, ...parts), "utf8");

const [rawText, chunksText, topicsText, sampleText, labelsText, casesText, manifestText] =
  await Promise.all([
    load("raw", "articles.jsonl"),
    load("processed", "chunks.jsonl"),
    load("processed", "by-topic.json"),
    load("samples", "bfs-rag-sample.jsonl"),
    load("samples", "bfs-sample-labels.json"),
    load("samples", "bfs-query-cases.json"),
    load("manifest.json"),
  ]);

const rawArticles = parseJsonl(rawText, "articles.jsonl");
const chunks = parseJsonl(chunksText, "chunks.jsonl");
const sample = parseJsonl(sampleText, "bfs-rag-sample.jsonl");
const labels = JSON.parse(labelsText);
const queryCases = JSON.parse(casesText).cases;
const topics = JSON.parse(topicsText);
const manifest = JSON.parse(manifestText);
const corpus = validateCorpus({ rawArticles, chunks });

const sampleIds = new Set(sample.map((item) => item.id));
const expectedSampleIds = new Set(labels.selection.map((item) => item.chunk_id));
if (sampleIds.size !== expectedSampleIds.size || [...expectedSampleIds].some((id) => !sampleIds.has(id))) {
  throw new Error("BFS sample does not match bfs-sample-labels.json");
}
const cases = validateQueryCases(queryCases, sampleIds);

for (const item of manifest.files) {
  const content = await readFile(path.join(datasetDirectory, item.path));
  const digest = createHash("sha256").update(content).digest("hex").toUpperCase();
  if (digest !== item.sha256) throw new Error(`SHA-256 mismatch: ${item.path}`);
}

const topicItems = Object.values(topics).reduce((total, items) => total + items.length, 0);
console.log(
  JSON.stringify(
    {
      corpus,
      topicGroups: Object.keys(topics).length,
      topicItems,
      bfsSampleRecords: sample.length,
      queryCases: cases,
      manifestFilesVerified: manifest.files.length,
    },
    null,
    2,
  ),
);
