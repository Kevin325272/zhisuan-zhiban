import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createTestKnowledgeBase } from "../src/services/test-knowledge-base.js";

const fixtureDirectory = fileURLToPath(
  new URL("../../../data/data-structures/samples/", import.meta.url),
);

describe("test knowledge base", () => {
  it("matches a paraphrased BFS shortest-path question to normal evidence", () => {
    const knowledgeBase = createTestKnowledgeBase({ fixtureDirectory });

    const result = knowledgeBase.retrieve("为什么 BFS 可以求无权图最短路？", "auto");

    expect(result).toMatchObject({
      scenario: "normal",
      confidenceLevel: "high",
      caseId: "bfs_shortest_path",
    });
    expect(result.chunks.map((chunk) => chunk.sourceId)).toEqual([
      "csdn_131792829_chunk_0002",
      "csdn_136340070_chunk_0005",
    ]);
  });

  it("keeps an out-of-scope networking question source-free", () => {
    const knowledgeBase = createTestKnowledgeBase({ fixtureDirectory });

    const result = knowledgeBase.retrieve("TCP 三次握手为什么不能只握手两次？", "auto");

    expect(result).toMatchObject({
      scenario: "rag_empty",
      confidenceLevel: "low",
      caseId: "out_of_scope_networking",
      chunks: [],
    });
  });

  it("marks a weighted-graph boundary question as low confidence", () => {
    const knowledgeBase = createTestKnowledgeBase({ fixtureDirectory });

    const result = knowledgeBase.retrieve("普通 BFS 能直接求任意带权图最短路吗？", "auto");

    expect(result).toMatchObject({
      scenario: "rag_low_confidence",
      confidenceLevel: "low",
      caseId: "bfs_weighted_graph",
    });
    expect(result.chunks).toHaveLength(1);
  });

  it("maps fixture chunks to traceable test citations", () => {
    const knowledgeBase = createTestKnowledgeBase({ fixtureDirectory });
    const citation = knowledgeBase.getCitation("csdn_119455799_chunk_0020");

    expect(citation).toMatchObject({
      source_id: "csdn_119455799_chunk_0020",
      document_id: "csdn_119455799",
      title: "《王道》数据结构笔记整理2022",
      author: "胖胖的懒羊羊",
      source_type: "test_fixture",
      section: "图与广度优先遍历",
      knowledge_base_version: "test_ds_bfs_v1",
      viewer_url: "https://blog.csdn.net/qq_44867340/article/details/119455799",
    });
    expect(citation?.snippet.length).toBeLessThanOrEqual(260);
  });

  it("honors a forced empty scenario without returning evidence", () => {
    const knowledgeBase = createTestKnowledgeBase({ fixtureDirectory });

    const result = knowledgeBase.retrieve("为什么 BFS 使用队列？", "rag_empty");

    expect(result).toMatchObject({
      scenario: "rag_empty",
      confidenceLevel: "low",
      chunks: [],
    });
  });
});
