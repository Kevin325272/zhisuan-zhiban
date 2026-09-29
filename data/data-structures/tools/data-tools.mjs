export function parseJsonl(text, label = "JSONL") {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label} line ${index + 1} is not valid JSON`, { cause: error });
      }
    });
}

function duplicates(items, key) {
  const seen = new Set();
  const repeated = new Set();
  for (const item of items) {
    const value = item[key];
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export function validateCorpus({ rawArticles, chunks }) {
  const errors = [];
  const duplicateRawIds = duplicates(rawArticles, "id");
  const duplicateChunkIds = duplicates(chunks, "id");
  const rawIds = new Set(rawArticles.map((article) => article.id));
  const orphanChunks = chunks
    .filter((chunk) => !rawIds.has(chunk.document_id))
    .map((chunk) => chunk.id);
  const emptyRaw = rawArticles.filter((article) => !article.text?.trim()).map((article) => article.id);
  const emptyChunks = chunks.filter((chunk) => !chunk.text?.trim()).map((chunk) => chunk.id);

  if (duplicateRawIds.length) errors.push(`duplicate raw ids: ${duplicateRawIds.join(", ")}`);
  if (duplicateChunkIds.length) {
    errors.push(`duplicate chunk ids: ${duplicateChunkIds.join(", ")}`);
  }
  if (orphanChunks.length) errors.push(`orphan chunks: ${orphanChunks.join(", ")}`);
  if (emptyRaw.length) errors.push(`empty raw text: ${emptyRaw.join(", ")}`);
  if (emptyChunks.length) errors.push(`empty chunk text: ${emptyChunks.join(", ")}`);
  if (errors.length) throw new Error(errors.join("; "));

  return {
    rawRecords: rawArticles.length,
    chunkRecords: chunks.length,
    duplicateRawIds: 0,
    duplicateChunkIds: 0,
    orphanChunks: 0,
    emptyTextRecords: 0,
  };
}

export function buildSample(chunks, requestedIds) {
  const requested = new Set(requestedIds);
  const available = new Set(chunks.map((chunk) => chunk.id));
  const missing = requestedIds.filter((id) => !available.has(id));
  if (missing.length) throw new Error(`sample ids not found: ${missing.join(", ")}`);
  return chunks.filter((chunk) => requested.has(chunk.id));
}

export function validateQueryCases(cases, sampleIds) {
  const duplicateCaseIds = duplicates(cases, "case_id");
  if (duplicateCaseIds.length) {
    throw new Error(`duplicate query case ids: ${duplicateCaseIds.join(", ")}`);
  }

  const counts = { cases: cases.length, normal: 0, lowConfidence: 0, empty: 0 };
  for (const item of cases) {
    if (!item.query?.trim()) throw new Error(`query case ${item.case_id} has an empty query`);
    if (!Array.isArray(item.expected_evidence_ids)) {
      throw new Error(`query case ${item.case_id} has no evidence list`);
    }

    const missing = item.expected_evidence_ids.filter((id) => !sampleIds.has(id));
    if (missing.length) {
      throw new Error(
        `query case ${item.case_id} references missing evidence: ${missing.join(", ")}`,
      );
    }

    if (item.scenario === "normal") {
      counts.normal += 1;
      if (!item.expected_evidence_ids.length) {
        throw new Error(`normal query case ${item.case_id} must cite evidence`);
      }
    } else if (item.scenario === "rag_low_confidence") {
      counts.lowConfidence += 1;
    } else if (item.scenario === "rag_empty") {
      counts.empty += 1;
      if (item.expected_evidence_ids.length) {
        throw new Error(`empty query case ${item.case_id} must not cite evidence`);
      }
    } else {
      throw new Error(`query case ${item.case_id} has an unknown scenario: ${item.scenario}`);
    }
  }
  return counts;
}
