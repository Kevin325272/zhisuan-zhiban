import {
  agentMessageRequestSchema,
  learningSessionRequestSchema,
  type AgentEvent,
  type AgentMessageRequest,
  type LearningSessionRequest,
} from "@xuetu/contracts";
import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ModelProviderError,
  type CourseConversationMessage,
  type CourseAnswerModel,
  type LearnerContext,
  type TutorHintLevel,
  type TutorRequestedAction,
  type TutorWorkspaceContext,
} from "../services/openai-compatible-chat.js";
import type {
  RetrievalMode,
  TestKnowledgeBase,
} from "../services/test-knowledge-base.js";
import type { PerUserAiRequestLimiter } from "../services/ai-request-limiter.js";

type MockScenario = RetrievalMode | "agent_timeout";

interface AgentRunDependencies {
  knowledgeBase: TestKnowledgeBase;
  answerModel: CourseAnswerModel | null;
  getLearnerContext: (
    session: LearningSessionRequest,
    request: FastifyRequest,
  ) => LearnerContext;
  getRequestUserId: (request: FastifyRequest) => string;
  aiRequestLimiter: PerUserAiRequestLimiter;
  /** 演示场景注入开关；生产环境应关闭，避免客户端伪造超时/降级事件。 */
  allowMockScenarios?: boolean;
}

interface LearningSessionState {
  ownerUserId: string;
  context: LearningSessionRequest;
  conversationHistory: CourseConversationMessage[];
}

type EmitEvent = (type: AgentEvent["type"], payload: Record<string, unknown>) => void;

interface AgentRunJob {
  ownerUserId: string;
  runId: string;
  status: "pending" | "running" | "completed";
  events: AgentEvent[];
  execute: ((emit: EmitEvent) => Promise<void>) | null;
  completion: Promise<void>;
  complete: () => void;
}

const MAX_TRACKED_RUNS = 200;
const MAX_TRACKED_SESSIONS = 500;

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function notFoundEnvelope(requestId: string, message: string) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: {
      code: "RESOURCE_NOT_FOUND",
      message,
      retryable: false,
      details: {},
    },
  };
}

function validationEnvelope(requestId: string, message: string, issues: unknown) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: {
      code: "VALIDATION_ERROR",
      message,
      retryable: false,
      details: { issues },
    },
  };
}

function rateLimitEnvelope(requestId: string) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: {
      code: "AI_REQUEST_LIMITED",
      message: "AI 学习请求较多，请稍后再试。",
      retryable: true,
      details: {},
    },
  };
}

function formatSse(event: AgentEvent) {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({
    run_id: event.run_id,
    sequence: event.sequence,
    created_at: event.created_at,
    payload: event.payload,
  })}\n\n`;
}

const conversationalShortInputs = new Set([
  "你好",
  "您好",
  "嗨",
  "hi",
  "hello",
  "在吗",
  "在不在",
  "嗯",
  "哦",
  "好",
  "好的",
  "ok",
  "谢谢",
  "测试",
]);

function isLowInformationMessage(content: string) {
  const normalized = content.trim().toLocaleLowerCase("zh-CN");
  if (conversationalShortInputs.has(normalized)) return true;
  return /^(?:\d+|[a-z]|[?？!！,.，。…]+)$/u.test(normalized);
}

function buildGuidedLearningReply(content: string, context: LearnerContext) {
  const normalized = content.trim();
  const weakPoint = context.weakPoints[0] ?? "当前知识掌握情况还需要通过一道小题进一步确认";
  return [
    `我在。你刚才发的是“${normalized}”，暂时还看不出你具体想问什么。`,
    `从最近的学习记录看，你正在学习 **${context.course} · ${context.currentTopic}**，${weakPoint}`,
    [
      "我可以帮你：",
      "- 解释一个没弄懂的知识点",
      "- 检查代码并定位错误原因",
      "- 根据当前薄弱点安排一道针对性练习",
    ].join("\n"),
    "你想先从哪一项开始？也可以直接把题目或代码发给我。",
  ].join("\n\n");
}

interface TutorJobInput {
  content: string;
  scenario: MockScenario;
  action: TutorRequestedAction;
  learnerContext: LearnerContext;
  hintLevel: TutorHintLevel;
  workspaceContext: TutorWorkspaceContext | null;
  conversationHistory: CourseConversationMessage[];
  onAssistantText: (text: string) => void;
}

function createTutorJobExecutor(
  input: TutorJobInput,
  dependencies: AgentRunDependencies,
): (emit: EmitEvent) => Promise<void> {
  return async (emit) => {
    const { content, scenario, action, hintLevel, workspaceContext } = input;

    if (scenario === "agent_timeout") {
      emit("run.started", { action_type: action });
      emit("stage.started", { stage: "evidence_review", label: "整理评测证据" });
      emit("run.failed", {
        error: {
          code: "AGENT_TIMEOUT",
          message: "诊断服务响应超时，客观评测证据仍可查看。",
          retryable: true,
        },
        fallback_action: "show_evidence",
      });
      return;
    }

    const learnerContext = input.learnerContext;
    if (action === "question_answer" && scenario === "auto" && isLowInformationMessage(content)) {
      const reply = buildGuidedLearningReply(content, learnerContext);
      emit("run.started", {
        action_type: "question_answer",
        model: dependencies.answerModel?.model ?? "unavailable",
      });
      emit("assistant.delta", {
        delta: reply,
        generated_by: "assistant_policy",
        answer_mode: "guided",
        profile_context_used: true,
      });
      emit("run.completed", {
        message_id: `msg_assistant_${input.conversationHistory.length + 1}`,
        finished_reason: "guided_clarification",
      });
      input.onAssistantText(reply);
      return;
    }

    const retrievalQuery =
      action === "question_answer"
        ? content
        : [
            content,
            workspaceContext?.task_title,
            workspaceContext?.test_summary,
            workspaceContext?.trace_summary,
            ...(workspaceContext?.failed_test_cases ?? []),
            ...(workspaceContext?.learner_weak_points ?? []),
          ]
            .filter((item): item is string => Boolean(item?.trim()))
            .join("\n");
    const retrieval = dependencies.knowledgeBase.retrieve(retrievalQuery, scenario);

    emit("run.started", {
      action_type: action,
      model: dependencies.answerModel?.model ?? "unavailable",
    });
    emit("stage.started", {
      stage: "course_retrieval",
      label: action === "diagnosis" ? "检索评测相关课程资料" : "检索测试知识库",
    });
    emit("retrieval.completed", {
      citation_ids: retrieval.chunks.map((chunk) => chunk.sourceId),
      confidence_level: retrieval.confidenceLevel,
      degraded: retrieval.scenario !== "normal",
      summary: retrieval.summary,
      knowledge_base_version: "test_ds_bfs_v1",
      source_type: "test_fixture",
    });

    if (!dependencies.answerModel) {
      const fallbackText = retrieval.chunks.length
        ? `模型未配置。根据测试来源，可先核对：${retrieval.answerPoints.length ? retrieval.answerPoints.join("；") : "请结合来源原文继续核对"}。`
        : "测试知识库未命中，且模型未配置，暂时无法生成通用回答。";
      emit("assistant.delta", {
        delta: fallbackText,
        generated_by: "fallback",
        answer_mode: retrieval.chunks.length ? "rag" : "unavailable",
      });
      emit("run.completed", {
        message_id: "msg_assistant_fallback",
        finished_reason: "fallback_without_model",
      });
      input.onAssistantText(fallbackText);
      return;
    }

    const hasSources = retrieval.chunks.length > 0;
    const answerMode = hasSources ? "rag" : "general";
    let streamedText = "";
    try {
      const lowConfidencePrefix =
        hasSources && retrieval.confidenceLevel === "low" ? "测试来源匹配度较低。" : "";
      if (lowConfidencePrefix) {
        streamedText += lowConfidencePrefix;
        emit("assistant.delta", {
          delta: lowConfidencePrefix,
          generated_by: "assistant_policy",
          answer_mode: answerMode,
        });
      }
      const answer = await dependencies.answerModel.answer(
        {
          question: content,
          requestedAction: action,
          confidenceLevel: retrieval.confidenceLevel,
          chunks: retrieval.chunks,
          learnerContext,
          conversationHistory: input.conversationHistory,
          hintLevel,
          workspaceContext,
        },
        {
          onDelta: (delta) => {
            streamedText += delta;
            emit("assistant.delta", {
              delta,
              generated_by: "model",
              answer_mode: answerMode,
            });
          },
        },
      );
      if (!streamedText.replace(/^测试来源匹配度较低。/u, "").trim()) {
        // 非流式提供方（或未产生增量）时回退为一次性输出。
        streamedText += answer.text;
        emit("assistant.delta", {
          delta: answer.text,
          generated_by: "model",
          answer_mode: answerMode,
        });
      }
      if (action === "diagnosis") {
        emit("diagnosis.completed", { diagnosis_id: "diag_stream_001" });
      }
      emit("run.completed", {
        message_id: "msg_assistant_model",
        requested_model: answer.requestedModel,
        provider_model: answer.providerModel,
        finished_reason: !hasSources
          ? "completed_without_sources"
          : retrieval.confidenceLevel === "low"
            ? "completed_with_low_confidence"
            : "completed",
      });
      input.onAssistantText(streamedText);
    } catch (error) {
      emit("run.failed", {
        error: {
          code: "MODEL_UPSTREAM_ERROR",
          message: "模型服务暂时不可用，请稍后重试。",
          retryable: error instanceof ModelProviderError ? error.retryable : true,
        },
        fallback_action: action === "diagnosis" ? "retry_diagnosis" : "retry_question",
      });
    }
  };
}

function trimMap<K, V>(map: Map<K, V>, maxEntries: number) {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) return;
    map.delete(oldestKey);
  }
}

export function registerAgentRunRoutes(app: FastifyInstance, dependencies: AgentRunDependencies) {
  const sessions = new Map<string, LearningSessionState>();
  const runs = new Map<string, AgentRunJob>();
  const allowMockScenarios = dependencies.allowMockScenarios ?? false;
  app.post<{ Body: unknown }>("/api/v1/learning-sessions", async (request, reply) => {
    const parsed = learningSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          validationEnvelope(
            request.id,
            "学习会话参数不完整或格式错误。",
            parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          ),
        );
    }
    const sessionId = `session_${randomUUID()}`;
    sessions.set(sessionId, {
      ownerUserId: dependencies.getRequestUserId(request),
      context: parsed.data,
      conversationHistory: [],
    });
    trimMap(sessions, MAX_TRACKED_SESSIONS);
    return reply.code(201).send(
      success(request.id, {
        session_id: sessionId,
        ...parsed.data,
        created_at: new Date().toISOString(),
      }),
    );
  });

  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    "/api/v1/learning-sessions/:sessionId/messages",
    async (request, reply) => {
      const session = sessions.get(request.params.sessionId);
      const requestUserId = dependencies.getRequestUserId(request);
      if (!session || session.ownerUserId !== requestUserId) {
        return reply
          .code(404)
          .send(notFoundEnvelope(request.id, "学习会话不存在。"));
      }

      const parsed = agentMessageRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            validationEnvelope(
              request.id,
              "消息参数不完整或格式错误。",
              parsed.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            ),
          );
      }
      const body: AgentMessageRequest = parsed.data;

      const messageId = `msg_user_${randomUUID()}`;
      const runId = `run_${randomUUID()}`;
      const requestedScenario = (body.mock_scenario ?? "auto") as MockScenario;
      const scenario: MockScenario = allowMockScenarios ? requestedScenario : "auto";
      const requestedAction = body.requested_action;

      let complete!: () => void;
      const completion = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const job: AgentRunJob = {
        ownerUserId: requestUserId,
        runId,
        status: "pending",
        events: [],
        execute: createTutorJobExecutor(
          {
            content: body.content,
            scenario,
            action: requestedAction,
            learnerContext: dependencies.getLearnerContext(session.context, request),
            hintLevel: body.hint_level ?? "clue",
            workspaceContext: body.workspace_context ?? null,
            conversationHistory: [...session.conversationHistory],
            onAssistantText: (text) => {
              if (requestedAction !== "question_answer") return;
              const assistantText = text.trim();
              if (!assistantText) return;
              session.conversationHistory.push(
                { role: "user", content: body.content },
                { role: "assistant", content: assistantText },
              );
              session.conversationHistory = session.conversationHistory.slice(-12);
            },
          },
          dependencies,
        ),
        completion,
        complete,
      };
      runs.set(runId, job);
      trimMap(runs, MAX_TRACKED_RUNS);

      return reply.code(201).send(
        success(request.id, {
          message_id: messageId,
          run_id: runId,
          event_url: `/api/v1/agent-runs/${runId}/events`,
        }),
      );
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/api/v1/agent-runs/:runId/events",
    async (request, reply) => {
      const job = runs.get(request.params.runId);
      if (!job || job.ownerUserId !== dependencies.getRequestUserId(request)) {
        return reply
          .code(404)
          .send(notFoundEnvelope(request.id, "Agent 运行不存在。"));
      }

      const rawLastEventId = request.headers["last-event-id"];
      const lastEventId =
        typeof rawLastEventId === "string" ? Number.parseInt(rawLastEventId, 10) : 0;
      const afterSequence = Number.isNaN(lastEventId) ? 0 : lastEventId;

      // 已执行过（或正在执行）的运行：一次性回放当前已累积的事件。
      if (job.execute === null) {
        if (job.status === "running") await job.completion;
        const remaining = job.events.filter((item) => item.sequence > afterSequence);
        return reply
          .header("Content-Type", "text/event-stream; charset=utf-8")
          .header("Cache-Control", "no-cache")
          .header("Connection", "keep-alive")
          .send(remaining.map(formatSse).join(""));
      }

      // 首次消费：边生成边写出（真流式）。
      const lease = dependencies.aiRequestLimiter.acquire(job.ownerUserId);
      if (!lease.allowed) {
        return reply
          .header("Retry-After", String(lease.retryAfterSeconds))
          .code(429)
          .send(rateLimitEnvelope(request.id));
      }
      const execute = job.execute;
      job.execute = null;
      job.status = "running";

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      let clientGone = false;
      request.raw.on("close", () => {
        clientGone = true;
      });

      const emit: EmitEvent = (type, payload) => {
        const event: AgentEvent = {
          run_id: job.runId,
          sequence: job.events.length + 1,
          type,
          created_at: new Date().toISOString(),
          payload,
        };
        job.events.push(event);
        if (!clientGone && event.sequence > afterSequence) {
          reply.raw.write(formatSse(event));
        }
      };

      try {
        await execute(emit);
      } catch {
        emit("run.failed", {
          error: {
            code: "AGENT_INTERNAL_ERROR",
            message: "助学服务处理失败，请稍后重试。",
            retryable: true,
          },
        });
      } finally {
        job.status = "completed";
        job.complete();
        lease.release();
        if (!clientGone) reply.raw.end();
      }
    },
  );
}
