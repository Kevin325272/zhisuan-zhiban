import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSample,
  parseJsonl,
  validateCorpus,
  validateQueryCases,
} from "./data-tools.mjs";

test("parseJsonl reports the failing line", () => {
  assert.throws(
    () => parseJsonl('{"id":"ok"}\nnot-json', "fixture"),
    /fixture line 2 is not valid JSON/,
  );
});

test("validateCorpus rejects duplicate ids and orphan chunks", () => {
  assert.throws(
    () =>
      validateCorpus({
        rawArticles: [
          { id: "doc-1", text: "A", metadata: {} },
          { id: "doc-1", text: "B", metadata: {} },
        ],
        chunks: [{ id: "chunk-1", document_id: "missing", text: "C", metadata: {} }],
      }),
    /duplicate raw ids: doc-1; orphan chunks: chunk-1/,
  );
});

test("buildSample preserves source order and rejects unknown ids", () => {
  const chunks = [
    { id: "chunk-1", document_id: "doc-1", text: "first", metadata: {} },
    { id: "chunk-2", document_id: "doc-1", text: "second", metadata: {} },
  ];

  assert.deepEqual(buildSample(chunks, ["chunk-2", "chunk-1"]), [chunks[0], chunks[1]]);
  assert.throws(() => buildSample(chunks, ["missing"]), /sample ids not found: missing/);
});

test("validateQueryCases requires traceable evidence for normal cases", () => {
  const sampleIds = new Set(["chunk-1"]);
  assert.deepEqual(
    validateQueryCases(
      [
        {
          case_id: "normal-1",
          scenario: "normal",
          query: "为什么 BFS 使用队列？",
          expected_evidence_ids: ["chunk-1"],
        },
        {
          case_id: "empty-1",
          scenario: "rag_empty",
          query: "TCP 三次握手是什么？",
          expected_evidence_ids: [],
        },
      ],
      sampleIds,
    ),
    { cases: 2, normal: 1, lowConfidence: 0, empty: 1 },
  );

  assert.throws(
    () =>
      validateQueryCases(
        [
          {
            case_id: "normal-2",
            scenario: "normal",
            query: "BFS 的时间复杂度？",
            expected_evidence_ids: ["missing"],
          },
        ],
        sampleIds,
      ),
    /query case normal-2 references missing evidence: missing/,
  );
});
