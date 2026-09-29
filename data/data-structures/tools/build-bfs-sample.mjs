import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSample, parseJsonl } from "./data-tools.mjs";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const datasetDirectory = path.dirname(toolsDirectory);
const chunksPath = path.join(datasetDirectory, "processed", "chunks.jsonl");
const labelsPath = path.join(datasetDirectory, "samples", "bfs-sample-labels.json");
const outputPath = path.join(datasetDirectory, "samples", "bfs-rag-sample.jsonl");

const [chunksText, labelsText] = await Promise.all([
  readFile(chunksPath, "utf8"),
  readFile(labelsPath, "utf8"),
]);
const chunks = parseJsonl(chunksText, "chunks.jsonl");
const labels = JSON.parse(labelsText);
const sample = buildSample(
  chunks,
  labels.selection.map((item) => item.chunk_id),
);

await writeFile(outputPath, `${sample.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
console.log(`Built ${sample.length} BFS retrieval fixtures at ${outputPath}`);
