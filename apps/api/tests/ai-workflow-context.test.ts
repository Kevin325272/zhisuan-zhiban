import { describe, expect, it } from "vitest";

import type {
  AiWorkflowCapability,
  AiWorkflowInvocation,
  StudentLearningOrchestration,
} from "@xuetu/contracts";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import {
  PostgresWorkflowContextRepository,
} from "../src/services/ai-workflow/postgres-workflow-context.js";
import {
  WorkflowContextIncompleteError,
} from "../src/services/ai-workflow/workflow-context.js";
import type {
  StudentCareRepository,
  StoredStudentCareInteraction,
} from "../src/services/student-care/student-care-service.js";

interface FakeOptions {
  missingAttempt?: boolean;
  missingConceptScopedAttempt?: boolean;
  unscopedConceptLinks?: "unique" | "none" | "multiple";
}

function fakePool(options: FakeOptions = {}) {
  const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
  const pool: SqlQueryablePool = {
    async connect(): Promise<SqlClient> {
      throw new Error("Context repository must not open a write transaction.");
    },
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<SqlQueryResult<Row>> {
      statements.push({ sql, ...(parameters ? { parameters } : {}) });
      let rows: unknown[] = [];
      if (sql.includes("FROM courses c")) {
        rows = [{
          course_id: "course_408_co",
          title: "计算机组成原理",
          discipline: "计算机科学与技术",
          question_subject: "组成原理",
        }];
      } else if (sql.includes("FROM course_core_concepts cc")) {
        rows = [{
          concept_id: "co_c01_01",
          title: "硬件、软件与计算机系统",
          learning_objective: "区分硬件与软件。",
          key_terms: ["硬件", "软件"],
        }];
      } else if (sql.includes("FROM course_content_chunks k")) {
        rows = [{
          chunk_id: "co_chunk_k0012",
          chapter: "1 计算机系统概论",
          print_page: 3,
          content_text: "计算机系统由硬件和软件共同组成。",
        }];
      } else if (sql.includes("FROM course_concept_sources s")) {
        rows = [{
          chunk_id: "co_chunk_k0012",
          chapter: "1 计算机系统概论",
          print_page: 3,
          content_text: "计算机系统由硬件和软件共同组成。",
        }];
      } else if (sql.includes("FROM course_reading_progress p")) {
        rows = [{
          chunk_id: "co_chunk_k0012",
          paragraph_index: 2,
          source_expanded: true,
          updated_at: "2026-07-28T00:00:00.000Z",
        }];
      } else if (sql.includes("FROM course_qa_examples q")) {
        rows = [{
          qa_id: "co_qa_001",
          question_text: "什么是机器字长？",
          answer_text: "CPU一次能处理的二进制位数。",
        }];
      } else if (sql.includes("FROM course_concept_question_links link")) {
        rows = options.unscopedConceptLinks === "none"
          ? []
          : options.unscopedConceptLinks === "multiple"
            ? [{ concept_id: "co_c01_01" }, { concept_id: "co_c02_01" }]
            : [{ concept_id: "co_c01_01" }];
      } else if (sql.includes("FROM practice_attempts pa")) {
        rows = options.missingAttempt
          || (options.missingConceptScopedAttempt && sql.includes("pa.concept_id"))
          ? []
          : [{
              attempt_id: "attempt_001",
              question_id: "question_001",
              subject: "组成原理",
              question_text: "MAR用于保存什么？",
              options: [
                { option_id: "A", text: "地址" },
                { option_id: "B", text: "数据" },
              ],
              selected_option_ids: ["B"],
              submitted_at: "2026-07-28T00:01:00.000Z",
              evaluation_id: "evaluation_001",
              grading_mode: "deterministic_choice",
              status: "incorrect",
              is_correct: false,
              score: 0,
              correct_option_ids: ["A"],
              explanation_text: "MAR保存访存地址。",
              evaluation_created_at: "2026-07-28T00:01:01.000Z",
            }];
      } else if (sql.includes("FROM learning_evidence le")) {
        rows = [{
          evidence_id: "evidence_001",
          outcome: "incorrect",
          created_at: "2026-07-28T00:01:01.000Z",
          subject: "组成原理",
          tags: ["存储器"],
        }];
      }
      return { rows: rows as Row[], rowCount: rows.length };
    },
  };
  return { pool, statements };
}

function invocation(
  capability: AiWorkflowCapability,
): AiWorkflowInvocation {
  return {
    contract_version: "0.2",
    capability,
    course_id: "course_408_co",
    concept_id:
      capability === "explain" || capability === "coach"
        ? "co_c01_01"
        : null,
    qa_id: capability === "coach" ? "co_qa_001" : null,
    attempt_id: capability === "diagnose" ? "attempt_001" : null,
    ...(capability === "care" ? { conversation_id: "care_talk_001" } : {}),
    user_message:
      capability === "coach"
        ? "请先给我第一步提示。"
        : capability === "care"
          ? "我最近有点跟不上计划，想先理清今天怎么开始。"
          : null,
  };
}

function careConsent(): StoredStudentCareInteraction {
  return {
    interactionId: "care_talk_001",
    userId: "user_student_001",
    signalCode: "rhythm_drop",
    ruleVersion: "student_care_v1",
    status: "responded",
    evidenceSummary: {
      internal_evidence_id: "evidence_private_001",
      raw_answer: "B",
      psychological_label: "焦虑",
      recent_score: 42,
    },
    reasonSummary: "最近一周完成学习任务的天数比你此前的节奏少。",
    response: "talk",
    presentedAt: "2026-08-20T01:00:00.000Z",
    respondedAt: "2026-08-20T01:05:00.000Z",
    expiresAt: "2026-08-21T01:00:00.000Z",
    cooldownUntil: "2026-08-27T01:05:00.000Z",
    lightSessionExpiresAt: null,
    lightStep: null,
    talkCourseId: "course_408_co",
    talkFallbackStep: {
      task_id: "task_ds_read",
      task_type: "course_reading",
      course_id: "course_408_co",
      course_title: "计算机组成原理",
      title: "回到上次阅读位置",
      detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
      estimated_minutes: 10,
      href: "/student/courses/computer-organization",
    },
  };
}

function careOrchestration(): Pick<
  import("../src/services/orchestration/learning-orchestration-service.js").StudentLearningOrchestrationService,
  "getSnapshot"
> {
  return {
    async getSnapshot() {
      return {
        generated_at: "2026-08-20T01:06:00.000Z",
        current_task: {
          task_id: "task_current_001",
          source: "mistake",
          task_type: "mistake_review",
          course_id: "course_408_co",
          course_title: "计算机组成原理",
          concept_id: "co_c01_01",
          concept_title: "Cache 地址映射",
          mistake_id: "mistake_private_001",
          title: "复习 Cache 地址映射",
          reason: "内部编排原因不得发送。",
          completion_criteria: "内部完成标准不得发送。",
          estimated_minutes: 20,
          href: "/student/practice?mode=mistake-review",
          practice_question_count: 1,
          evidence_refs: ["evidence_private_001"],
        },
      } as StudentLearningOrchestration;
    },
  };
}

describe("PostgreSQL AI workflow context", () => {
  it("rejects care context before an explicit recent talk response", async () => {
    const { pool, statements } = fakePool();
    const studentCare = {
      async findInteraction() {
        return null;
      },
      async findRecentTalkConsent() {
        return null;
      },
    } as never;
    const repository = new PostgresWorkflowContextRepository(
      pool,
      careOrchestration(),
      studentCare,
      () => new Date("2026-08-20T02:00:00.000Z"),
    );

    await expect(repository.build({
      requestId: "workflow_care_without_consent",
      userId: "user_student_001",
      invocation: invocation("care"),
    })).rejects.toMatchObject({
      name: "WorkflowContextIncompleteError",
      reason: "care_consent",
    });

    expect(statements.some(({ sql }) => sql.includes("FROM practice_attempts"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("FROM learning_evidence"))).toBe(false);
  });

  it("builds a minimal care context from recent consent and the current legal task", async () => {
    const { pool, statements } = fakePool();
    const consentCalls: Array<{ userId: string; interactionId: string }> = [];
    const studentCare = {
      async findInteraction(userId: string, interactionId: string) {
        consentCalls.push({ userId, interactionId });
        return careConsent();
      },
      async findRecentTalkConsent() {
        throw new Error("care conversations must use their exact interaction");
      },
    } as never;
    const repository = new PostgresWorkflowContextRepository(
      pool,
      careOrchestration(),
      studentCare,
      () => new Date("2026-08-20T02:00:00.000Z"),
    );

    const result = await repository.build({
      requestId: "workflow_care_with_consent",
      userId: "user_student_001",
      invocation: invocation("care"),
    });

    expect(result).toMatchObject({
      capability: "care",
      slot: "supportive_check_in",
      course_id: "course_408_co",
      concept_id: null,
      source_chunk_ids: [],
      attempt_id: null,
      learning_evidence: [],
      context: {
        concept: null,
        source_chunks: [],
        reading_progress: null,
        qa_case: null,
        attempt: null,
        evaluation: null,
        care_check_in: {
          conversation_id: "care_talk_001",
          recent_turns: [],
          signal_code: "rhythm_drop",
          reason_summary: "最近一周完成学习任务的天数比你此前的节奏少。",
          consented_at: "2026-08-20T01:05:00.000Z",
          current_task: {
            task_id: "task_current_001",
            task_type: "mistake_review",
            course_id: "course_408_co",
            course_title: "计算机组成原理",
            concept_title: "Cache 地址映射",
            title: "复习 Cache 地址映射",
            estimated_minutes: 20,
            href: "/student/practice?mode=mistake-review",
          },
        },
      },
    });
    expect(consentCalls).toHaveLength(1);
    expect(consentCalls[0]).toMatchObject({
      userId: "user_student_001",
      interactionId: "care_talk_001",
    });
    expect(statements.some(({ sql }) => sql.includes("FROM practice_attempts"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("FROM learning_evidence"))).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("evidence_private_001");
    expect(serialized).not.toContain("mistake_private_001");
    expect(serialized).not.toContain("raw_answer");
    expect(serialized).not.toContain("recent_score");
    expect(serialized).not.toContain("焦虑");
    expect(serialized).not.toContain("内部编排原因");
    expect(serialized).not.toContain("内部完成标准");
  });

  it("expires care talk consent at the exact 24-hour boundary", async () => {
    const { pool } = fakePool();
    const repository = new PostgresWorkflowContextRepository(
      pool,
      careOrchestration(),
      {
        async findInteraction() { return careConsent(); },
      } as never,
      () => new Date("2026-08-21T01:05:00.000Z"),
    );

    await expect(repository.build({
      requestId: "workflow_care_expired_consent",
      userId: "user_student_001",
      invocation: invocation("care"),
    })).rejects.toMatchObject({
      name: "WorkflowContextIncompleteError",
      reason: "care_consent",
    });
  });

  it("adds the deterministic current task and evidence summary to plan context", async () => {
    const { pool } = fakePool();
    const repository = new PostgresWorkflowContextRepository(pool, {
      async getSnapshot() {
        return {
          generated_at: "2026-08-14T00:00:00.000Z",
          current_task: {
            task_id: "live_mistake_001",
            course_id: "course_408_co",
            title: "复习：Cache 地址映射",
            reason: "存在尚未完成的确定性错题复习。",
            completion_criteria: "完成错题重练并查看确定性评测。",
            estimated_minutes: 20,
          },
          evidence_summary: {
            confidence: "developing",
            reading_progress_count: 1,
            practice_attempt_count: 2,
            needs_review_count: 1,
          },
        } as StudentLearningOrchestration;
      },
    });

    const plan = await repository.build({
      requestId: "workflow_plan_with_task",
      userId: "user_student_001",
      invocation: invocation("plan"),
    });

    expect(plan.learning_evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "weakness_signal",
        summary: "当前确定性任务：复习：Cache 地址映射；安排原因：存在尚未完成的确定性错题复习；完成标准：完成错题重练并查看确定性评测；预计用时：20 分钟",
      }),
      expect.objectContaining({
        kind: "weakness_signal",
        summary: "证据摘要：1 条课程阅读位置，2 次真实作答，1 个待复习项；证据正在形成。",
      }),
    ]));
    expect(JSON.stringify(plan.learning_evidence)).not.toContain("。；");
    expect(JSON.stringify(plan.learning_evidence)).not.toContain("developing");
    expect(JSON.stringify(plan.learning_evidence)).not.toContain("/student/");
  });

  it("builds plan, explain, coach and diagnose from owned database records", async () => {
    const { pool, statements } = fakePool();
    const repository = new PostgresWorkflowContextRepository(pool);

    const plan = await repository.build({
      requestId: "workflow_plan_001",
      userId: "user_student_001",
      invocation: invocation("plan"),
    });
    expect(plan.context.course.title).toBe("计算机组成原理");
    expect(plan.context.reading_progress?.paragraph_index).toBe(2);
    expect(plan.source_chunk_ids).toEqual(["co_chunk_k0012"]);
    expect(plan.context.attempt?.attempt_id).toBe("attempt_001");
    expect(plan.learning_evidence.map((item) => item.evidence_id)).toContain(
      "evidence_001",
    );

    const explain = await repository.build({
      requestId: "workflow_explain_001",
      userId: "user_student_001",
      invocation: invocation("explain"),
    });
    expect(explain.context.concept?.concept_id).toBe("co_c01_01");
    expect(explain.source_chunk_ids).toEqual(["co_chunk_k0012"]);
    expect(explain.context.source_chunks[0]?.content).toContain("硬件和软件");
    expect(explain.context.qa_case).toBeNull();

    const coach = await repository.build({
      requestId: "workflow_coach_001",
      userId: "user_student_001",
      invocation: invocation("coach"),
    });
    expect(coach.context.qa_case).toMatchObject({
      qa_id: "co_qa_001",
      question: "什么是机器字长？",
    });
    expect(coach.user_message).toBe("请先给我第一步提示。");

    const diagnose = await repository.build({
      requestId: "workflow_diagnose_001",
      userId: "user_student_001",
      invocation: invocation("diagnose"),
    });
    expect(diagnose.context.attempt).toMatchObject({
      attempt_id: "attempt_001",
      selected_option_ids: ["B"],
    });
    expect(diagnose.context.evaluation).toMatchObject({
      status: "incorrect",
      correct_option_ids: ["A"],
    });
    expect(diagnose.context).not.toHaveProperty("evidence_payload");

    expect(statements.length).toBeGreaterThan(4);
    expect(statements.every(({ sql }) => sql.trimStart().startsWith("SELECT"))).toBe(true);
    expect(statements.some(({ parameters }) =>
      parameters?.includes("user_student_001"),
    )).toBe(true);
  });

  it("carries a concept-scoped diagnosis source into the workflow context", async () => {
    const { pool } = fakePool();
    const repository = new PostgresWorkflowContextRepository(pool);

    const result = await repository.build({
      requestId: "workflow_diagnose_with_concept",
      userId: "user_student_001",
      invocation: {
        ...invocation("diagnose"),
        concept_id: "co_c01_01",
      },
    });

    expect(result.concept_id).toBe("co_c01_01");
    expect(result.source_chunk_ids).toEqual(["co_chunk_k0012"]);
    expect(result.context.concept?.title).toBe("硬件、软件与计算机系统");
    expect(result.context.source_chunks[0]?.source_chunk_id).toBe("co_chunk_k0012");
  });

  it("does not mix a concept with an attempt persisted for another concept", async () => {
    const { pool } = fakePool({ missingConceptScopedAttempt: true });
    const repository = new PostgresWorkflowContextRepository(pool);

    await expect(repository.build({
      requestId: "workflow_diagnose_mismatched_concept",
      userId: "user_student_001",
      invocation: {
        ...invocation("diagnose"),
        concept_id: "co_c01_01",
      },
    })).rejects.toBeInstanceOf(WorkflowContextIncompleteError);
  });

  it("does not reveal whether a missing or unowned attempt exists", async () => {
    const { pool } = fakePool({ missingAttempt: true });
    const repository = new PostgresWorkflowContextRepository(pool);

    await expect(repository.build({
      requestId: "workflow_diagnose_missing",
      userId: "user_student_001",
      invocation: invocation("diagnose"),
    })).rejects.toBeInstanceOf(WorkflowContextIncompleteError);
  });

  it("resolves one verified concept for an unscoped full-exam diagnosis", async () => {
    const { pool, statements } = fakePool({ unscopedConceptLinks: "unique" });
    const repository = new PostgresWorkflowContextRepository(pool);

    const result = await repository.build({
      requestId: "workflow_diagnose_full_exam_unique",
      userId: "user_student_001",
      invocation: invocation("diagnose"),
    });

    expect(result.concept_id).toBe("co_c01_01");
    expect(result.context.concept?.concept_id).toBe("co_c01_01");
    expect(result.source_chunk_ids).toEqual(["co_chunk_k0012"]);
    expect(result.context.attempt?.question_id).toBe("question_001");
    const linkQuery = statements.find(({ sql }) =>
      sql.includes("FROM course_concept_question_links link"),
    );
    expect(linkQuery?.parameters).toEqual(expect.arrayContaining([
      "user_student_001",
      "course_408_co",
      "attempt_001",
      "question_001",
      "组成原理",
    ]));
  });

  it.each(["none", "multiple"] as const)("fails closed for %s during an unscoped full-exam diagnosis", async (linkMode) => {
    const { pool, statements } = fakePool({ unscopedConceptLinks: linkMode });
    const repository = new PostgresWorkflowContextRepository(pool);

    await expect(repository.build({
      requestId: `workflow_diagnose_full_exam_${linkMode}`,
      userId: "user_student_001",
      invocation: invocation("diagnose"),
    })).rejects.toMatchObject({
      name: "WorkflowContextIncompleteError",
      reason: "source_chunks",
    });
    expect(statements.some(({ sql }) => sql.includes("FROM course_concept_sources s"))).toBe(false);
  });
});
