import { pathToFileURL } from "node:url";
import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  aiWorkflowRequestSchema,
  aiWorkflowResponseSchema,
  type AiWorkflowCapability,
  type AiWorkflowRequest,
} from "@xuetu/contracts";

export interface AiWorkflowConformanceResult {
  capability: AiWorkflowCapability;
  ok: boolean;
  status: number | null;
  code: string;
}

export interface AiWorkflowConformanceReport {
  ok: boolean;
  contract_version: "0.2";
  results: AiWorkflowConformanceResult[];
}

function baseContext() {
  return {
    student: { user_id: "user_student_001" },
    course: {
      course_id: "course_408_co",
      title: "计算机组成原理",
      discipline: "计算机科学与技术",
    },
    reading_progress: {
      chunk_id: "co_k_1",
      paragraph_index: 1,
      source_expanded: false,
      updated_at: "2026-07-28T09:00:00.000Z",
    },
  } as const;
}

export function buildAiWorkflowConformanceFixtures(): AiWorkflowRequest[] {
  const sharedEvidence = [{
    evidence_id: "evidence_contract_001",
    kind: "reading_progress" as const,
    summary: "契约测试固定阅读证据。",
    observed_at: "2026-07-28T09:00:00.000Z",
  }];
  const concept = {
    concept_id: "co_c01_01",
    title: "硬件、软件与计算机系统",
    learning_objective: "区分硬件与软件，并说明二者如何共同构成计算机系统。",
    key_terms: ["硬件", "软件", "计算机系统"],
  };
  const sourceChunks = [{
    source_chunk_id: "co_k_1",
    chapter: "1 计算机系统概论",
    locator: "课程资料固定测试定位",
    content: "契约测试使用的最小课程来源内容。",
  }];

  const fixtures: AiWorkflowRequest[] = [
    {
      contract_version: "0.2",
      request_id: "workflow_contract_plan",
      capability: "plan",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.plan,
      user_id: "user_student_001",
      course_id: "course_408_co",
      concept_id: null,
      source_chunk_ids: [],
      attempt_id: null,
      learning_evidence: sharedEvidence,
      user_message: null,
      context: {
        ...baseContext(),
        concept: null,
        source_chunks: [],
        qa_case: null,
        attempt: null,
        evaluation: null,
      },
    },
    {
      contract_version: "0.2",
      request_id: "workflow_contract_explain",
      capability: "explain",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.explain,
      user_id: "user_student_001",
      course_id: "course_408_co",
      concept_id: concept.concept_id,
      source_chunk_ids: sourceChunks.map((chunk) => chunk.source_chunk_id),
      attempt_id: null,
      learning_evidence: sharedEvidence,
      user_message: "请解释当前概念。",
      context: {
        ...baseContext(),
        concept,
        source_chunks: sourceChunks,
        qa_case: null,
        attempt: null,
        evaluation: null,
      },
    },
    {
      contract_version: "0.2",
      request_id: "workflow_contract_coach",
      capability: "coach",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.coach,
      user_id: "user_student_001",
      course_id: "course_408_co",
      concept_id: concept.concept_id,
      source_chunk_ids: sourceChunks.map((chunk) => chunk.source_chunk_id),
      attempt_id: null,
      learning_evidence: sharedEvidence,
      user_message: "先给我一个提示。",
      context: {
        ...baseContext(),
        concept,
        source_chunks: sourceChunks,
        qa_case: {
          qa_id: "co_q_1",
          question: "什么是机器字长？",
          answer: "课程资料中的固定示例答案。",
        },
        attempt: null,
        evaluation: null,
      },
    },
    {
      contract_version: "0.2",
      request_id: "workflow_contract_diagnose",
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      user_id: "user_student_001",
      course_id: "course_408_co",
      concept_id: concept.concept_id,
      source_chunk_ids: sourceChunks.map((chunk) => chunk.source_chunk_id),
      attempt_id: "attempt_contract_001",
      learning_evidence: [{
        evidence_id: "evidence_contract_answer",
        kind: "answer_result",
        summary: "组成原理选择题确定性判分为错误。",
        observed_at: "2026-07-28T09:30:00.000Z",
      }],
      user_message: null,
      context: {
        ...baseContext(),
        concept,
        source_chunks: sourceChunks,
        qa_case: null,
        attempt: {
          attempt_id: "attempt_contract_001",
          question_id: "question_contract_001",
          subject: "组成原理",
          question_text: "MAR 用于保存什么？",
          options: [
            { option_id: "A", text: "指令地址" },
            { option_id: "B", text: "访存地址" },
          ],
          selected_option_ids: ["A"],
          submitted_at: "2026-07-28T09:30:00.000Z",
        },
        evaluation: {
          evaluation_id: "evaluation_contract_001",
          grading_mode: "deterministic_choice",
          status: "incorrect",
          is_correct: false,
          score: 0,
          correct_option_ids: ["B"],
          explanation: "MAR 保存当前要访问的存储单元地址。",
          created_at: "2026-07-28T09:30:01.000Z",
        },
      },
    },
  ];

  return fixtures.map((fixture) => aiWorkflowRequestSchema.parse(fixture));
}

async function checkFixture(
  baseUrl: string,
  secret: string,
  fixture: AiWorkflowRequest,
  timeoutMs: number,
): Promise<AiWorkflowConformanceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/u, "")}/v1/ai-workflows/${fixture.capability}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          "Idempotency-Key": fixture.request_id,
          "X-Xuetu-Contract-Version": "0.2",
        },
        body: JSON.stringify(fixture),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return {
        capability: fixture.capability,
        ok: false,
        status: response.status,
        code: `HTTP_${response.status}`,
      };
    }
    const parsed = aiWorkflowResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        capability: fixture.capability,
        ok: false,
        status: response.status,
        code: "RESPONSE_SCHEMA_INVALID",
      };
    }
    const sourceIds = new Set(fixture.source_chunk_ids);
    const evidenceIds = new Set(
      fixture.learning_evidence.map((item) => item.evidence_id),
    );
    const owned = parsed.data.request_id === fixture.request_id
      && parsed.data.capability === fixture.capability
      && parsed.data.citations.every((item) => sourceIds.has(item.source_chunk_id))
      && parsed.data.evidence_refs.every((item) => evidenceIds.has(item.evidence_id));
    return {
      capability: fixture.capability,
      ok: owned,
      status: response.status,
      code: owned ? "OK" : "REFERENCE_OWNERSHIP_INVALID",
    };
  } catch (error) {
    return {
      capability: fixture.capability,
      ok: false,
      status: null,
      code: error instanceof DOMException && error.name === "AbortError"
        ? "TIMEOUT"
        : "NETWORK_ERROR",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiWorkflowConformance(options: {
  baseUrl: string;
  secret: string;
  timeoutMs?: number;
}): Promise<AiWorkflowConformanceReport> {
  if (!options.baseUrl.trim() || !options.secret.trim()) {
    throw new Error("baseUrl and secret are required for conformance.");
  }
  const results = await Promise.all(
    buildAiWorkflowConformanceFixtures().map((fixture) =>
      checkFixture(
        options.baseUrl,
        options.secret,
        fixture,
        options.timeoutMs ?? 20_000,
      ),
    ),
  );
  return {
    ok: results.every((result) => result.ok),
    contract_version: "0.2",
    results,
  };
}

async function main() {
  const baseUrl = process.env.AI_WORKFLOW_BASE_URL ?? "";
  const secret = process.env.AI_WORKFLOW_SECRET ?? "";
  const report = await runAiWorkflowConformance({ baseUrl, secret });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `AI workflow conformance failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  });
}
