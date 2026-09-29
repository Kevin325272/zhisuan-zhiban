import { describe, expect, it } from "vitest";

import type { SqlQueryResult, SqlQueryablePool } from "../src/database/client.js";
import {
  PostgresExternalQuestionConceptMatcher,
  rankExternalQuestionConcepts,
  type ExternalQuestionConceptSource,
} from "../src/services/external-questions/concept-matcher.js";

function concept(
  overrides: Partial<ExternalQuestionConceptSource> = {},
): ExternalQuestionConceptSource {
  return {
    conceptId: "ds_queue_circular",
    courseId: "course_408_ds",
    courseSlug: "data-structures",
    title: "循环队列",
    learningObjective: "理解循环队列中队头与队尾指针的关系，并判断队空和队满。",
    terms: ["循环队列", "队头", "队尾", "队空", "队满"],
    ...overrides,
  };
}

describe("rankExternalQuestionConcepts", () => {
  it("ranks the verified circular-queue concept from confirmed content", () => {
    const concepts = [
      concept(),
      concept({
        conceptId: "ds_stack",
        title: "栈",
        learningObjective: "理解栈的后进先出特征。",
        terms: ["栈", "后进先出"],
      }),
    ];
    const ranked = rankExternalQuestionConcepts({
      text: "循环队列通过队头和队尾指针判断队空与队满",
      formulae: [],
      diagramDescription: null,
      keywords: ["循环队列", "队头", "队尾"],
      concepts,
    });

    expect(ranked.map((item) => item.conceptId)).toEqual(["ds_queue_circular"]);
    expect(ranked[0]).toMatchObject({ score: 8, title: "循环队列" });
    expect(ranked[0]?.reason).toMatch(/题目关键词|概念标题/u);
  });

  it("uses the documented weights, caps at eight and sorts ties by concept_id", () => {
    const ranked = rankExternalQuestionConcepts({
      text: "cache miss 后需要替换缓存块",
      formulae: ["miss rate = miss / access"],
      diagramDescription: null,
      keywords: ["cache miss"],
      concepts: [
        concept({
          conceptId: "co_cache_b",
          courseId: "course_408_co",
          courseSlug: "computer-organization",
          title: "Cache 缺失 B",
          learningObjective: "理解 cache miss 与替换策略。",
          terms: ["cache miss", "替换"],
        }),
        concept({
          conceptId: "co_cache_a",
          courseId: "course_408_co",
          courseSlug: "computer-organization",
          title: "Cache 缺失 A",
          learningObjective: "理解 cache miss 与替换策略。",
          terms: ["cache miss", "替换"],
        }),
      ],
    });

    expect(ranked.map(({ conceptId, score }) => ({ conceptId, score }))).toEqual([
      { conceptId: "co_cache_a", score: 7 },
      { conceptId: "co_cache_b", score: 7 },
    ]);

    const exact = rankExternalQuestionConcepts({
      text: "循环队列",
      formulae: [],
      diagramDescription: null,
      keywords: ["循环队列", "队空"],
      concepts: [concept()],
    });
    expect(exact[0]?.score).toBe(8);
  });

  it("returns no concept below four and never pads guesses", () => {
    expect(rankExternalQuestionConcepts({
      text: "这是一段没有对应概念的内容",
      formulae: [],
      diagramDescription: null,
      keywords: ["无关词"],
      concepts: [concept()],
    })).toEqual([]);
  });

  it("ignores AI keywords that are absent from the student-confirmed content", () => {
    expect(rankExternalQuestionConcepts({
      text: "顺序表通过下标访问元素",
      formulae: [],
      diagramDescription: null,
      keywords: ["循环队列", "队头", "队尾"],
      concepts: [concept()],
    })).toEqual([]);
  });

  it("caps output at eight and keeps reasons bounded without exposing scores in API candidates", () => {
    const concepts = Array.from({ length: 12 }, (_, index) => concept({
      conceptId: `ds_queue_${String(index).padStart(2, "0")}`,
      title: `循环队列 ${index}`,
      terms: ["循环队列"],
    }));
    const ranked = rankExternalQuestionConcepts({
      text: "循环队列",
      formulae: [],
      diagramDescription: null,
      keywords: ["循环队列"],
      concepts,
    });

    expect(ranked).toHaveLength(8);
    expect(ranked.every((item) => item.reason.length <= 120)).toBe(true);
    expect(ranked[0]?.candidate).not.toHaveProperty("score");
    expect(ranked[0]?.candidate).toEqual(expect.objectContaining({
      reading_href: expect.stringMatching(/^\/student\/courses\/data-structures\?concept_id=/u),
      practice_href: expect.stringMatching(/^\/student\/practice\?subject=/u),
    }));
  });
});

describe("PostgresExternalQuestionConceptMatcher", () => {
  it("loads only the authenticated student's verified subject concepts and terms", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("concept loading must not open a transaction"); },
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, parameters });
        return {
          rows: [{
            concept_id: "ds_queue_circular",
            course_id: "course_408_ds",
            course_slug: "data-structures",
            title: "循环队列",
            learning_objective: "理解循环队列中队头和队尾指针。",
            terms: ["循环队列", "队头", "队尾"],
          }] as Row[],
          rowCount: 1,
        };
      },
    };
    const matcher = new PostgresExternalQuestionConceptMatcher(pool);

    await expect(matcher.match({
      userId: "student_a",
      subject: "data_structures",
      text: "循环队列通过队头和队尾指针判断队空",
      formulae: [],
      diagramDescription: null,
      keywords: ["循环队列"],
    })).resolves.toEqual([
      expect.objectContaining({
        concept_id: "ds_queue_circular",
        course_id: "course_408_ds",
        course_slug: "data-structures",
      }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.parameters).toEqual(["student_a", "course_408_ds"]);
    expect(calls[0]?.sql).toContain("concept.review_status = 'verified'");
    expect(calls[0]?.sql).toContain("membership.user_id = $1");
    expect(calls[0]?.sql).toContain("membership.membership_role = 'student'");
    expect(calls[0]?.sql).toContain("membership.status = 'active'");
    expect(calls[0]?.sql).toContain("course_concept_terms");
  });

  it("returns an empty list when the subject course has no authorized verified concepts", async () => {
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
        return { rows: [], rowCount: 0 };
      },
    };
    const matcher = new PostgresExternalQuestionConceptMatcher(pool);
    await expect(matcher.match({
      userId: "student_a",
      subject: "computer_networks",
      text: "拥塞窗口发生变化",
      formulae: [],
      diagramDescription: null,
      keywords: ["拥塞窗口"],
    })).resolves.toEqual([]);
  });
});
