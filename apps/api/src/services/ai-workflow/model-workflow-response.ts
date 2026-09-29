import { z } from "zod";

import {
  aiWorkflowResponseSchema,
  learningDiagramSchema,
  type AiWorkflowCapability,
  type AiWorkflowRequest,
  type AiWorkflowResponse,
  type AiWorkflowRuntimeStatus,
} from "@xuetu/contracts";

import { failedWorkflowResponse } from "./ai-workflow-gateway.js";
import { careOutputIsSafe } from "./care-output-policy.js";

const modelNextActionSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({
    kind: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(500),
    target: z.string().trim().min(1).max(500).nullable().optional(),
  }).passthrough(),
]);

export const modelWorkflowAnswerSchema = z
  .object({
    status: z.enum(["success", "failed"]),
    request_id: z.string().trim().min(1).optional(),
    display_blocks: z.union([
      z.string().trim().min(1).max(12_000),
      z.array(z.union([
        z.string().trim().min(1).max(8_000),
        z.object({
          kind: z.string().trim().min(1).max(100),
          content: z.string().trim().min(1).max(8_000),
        }).passthrough(),
      ])).max(20),
    ]).optional().default([]),
    reference_ids: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
    next_actions: z.array(modelNextActionSchema).max(10).default([]),
    evidence_candidate: z.string().trim().max(2_000).nullable().optional(),
    failure_reasons: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    // Invalid optional graphics must not discard an otherwise useful explanation.
    diagram: learningDiagramSchema.nullable().optional().catch(undefined),
  })
  .passthrough();

export type ModelWorkflowAnswer = z.infer<typeof modelWorkflowAnswerSchema>;

interface ModelWorkflowBoundary {
  allowedReferenceIds: readonly string[];
  allowedActionTargets: readonly string[];
}

const capabilityTitle: Record<AiWorkflowCapability, string> = {
  plan: "下一步学习安排",
  explain: "课程概念讲解",
  coach: "案例分步提示",
  diagnose: "作答诊断",
  care: "学伴交流",
};

export function workflowFallbackMessage(capability: AiWorkflowCapability) {
  const messages: Record<AiWorkflowCapability, string> = {
    plan: "课程目录与非AI学习路径仍可使用。",
    explain: "当前教材讲解仍可继续阅读。",
    coach: "导入的课程案例仍可查看。",
    diagnose: "确定性评测结果仍可查看，并可继续下一题。",
    care: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
  };
  return messages[capability];
}

export function workflowFailure(
  request: AiWorkflowRequest,
  status: "unavailable" | "failed" | "insufficient_context",
  code: "UPSTREAM_UNAVAILABLE" | "WORKFLOW_TIMEOUT" | "WORKFLOW_FAILED" | "CONTEXT_INCOMPLETE",
  message: string,
  retryable: boolean,
): AiWorkflowResponse {
  return failedWorkflowResponse(request, status, {
    code,
    message,
    retryable,
    fallback_message: workflowFallbackMessage(request.capability),
  });
}

function actionKind(label: string, upstreamKind: string | null = null) {
  if (upstreamKind === "read") return "continue_learning" as const;
  if (upstreamKind === "practice") return "start_practice" as const;
  if (upstreamKind === "retry") return "retry_workflow" as const;
  if (/(练习|重做|作答|提交)/u.test(label)) return "start_practice" as const;
  if (/(阅读|继续|复习|概念)/u.test(label)) return "continue_learning" as const;
  return "none" as const;
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizedOptionText(value: string) {
  return value.replace(/[\s，。；、：:,.!?！？（）()\[\]【】]/gu, "").toLocaleLowerCase("zh-CN");
}

export function possibleAnswerLeak(request: AiWorkflowRequest, content: string) {
  if (/(?:correct_option_ids|answer_key|standard_answer|correct_answer)/iu.test(content)) {
    return true;
  }
  const evaluation = request.context.evaluation;
  const attempt = request.context.attempt;
  if (!evaluation || !attempt) {
    return /(正确答案|标准答案|正确选项)\s*[:：]?\s*[A-HＡ-Ｈ]/u.test(content)
      || /答案\s*(?:是|为)\s*[A-HＡ-Ｈ]/u.test(content)
      || /(?:应选|选择)\s*[A-HＡ-Ｈ](?:\b|项|选项)/u.test(content);
  }

  const ordinalLabels = [
    "第一", "第二", "第三", "第四", "第五", "第六", "第七", "第八", "第九", "第十",
    "第十一", "第十二", "第十三", "第十四", "第十五", "第十六", "第十七", "第十八", "第十九", "第二十",
  ];
  const correctIds = new Set(evaluation.correct_option_ids.map((id) => id.toLocaleLowerCase("zh-CN")));
  for (const [index, option] of attempt.options.entries()) {
    if (!correctIds.has(option.option_id.toLocaleLowerCase("zh-CN"))) continue;
    const id = escapedPattern(option.option_id);
    const ordinal = ordinalLabels[index];
    const numericPosition = String(index + 1);
    const choiceCue = "(?:正确(?:答案|选项)?(?:是|为|的为|的是)?|答案(?:是|为)?|应选|选择|选中)";
    if (new RegExp(`${choiceCue}\\s*(?:第?\\s*)?${id}(?:\\b|项|选项)`, "iu").test(content)) {
      return true;
    }
    if (new RegExp(`${choiceCue}\\s*(?:第?\\s*)?${numericPosition}(?:\\b|项|选项)`, "iu").test(content)) {
      return true;
    }
    if (ordinal && new RegExp(`${choiceCue}\\s*${ordinal}(?:项|个选项)?`, "iu").test(content)) {
      return true;
    }
    const normalizedCorrectText = normalizedOptionText(option.text);
    if (
      normalizedCorrectText.length >= 4
      && normalizedOptionText(content).includes(normalizedCorrectText)
    ) {
      return true;
    }
    if (normalizedCorrectText.length > 0 && normalizedCorrectText.length < 4) {
      const normalizedContent = normalizedOptionText(content);
      const shortAnswerCues = [
        "正确答案是",
        "正确答案为",
        "正确的是",
        "正确项是",
        "答案是",
        "答案为",
        "应选",
        "应该选",
        "应选择",
        "应该选择",
        "应使用",
        "应该使用",
        "应填",
        "应该填",
      ];
      if (shortAnswerCues.some((cue) =>
        normalizedContent.includes(`${cue}${normalizedCorrectText}`)
      )) {
        return true;
      }
    }
  }
  return false;
}

export function workflowResponseIsSafe(
  request: AiWorkflowRequest,
  response: AiWorkflowResponse,
) {
  if (
    response.request_id !== request.request_id
    || response.capability !== request.capability
    || response.slot !== request.slot
  ) {
    return false;
  }
  const sourceChunkIds = new Set(request.source_chunk_ids);
  if (response.citations.some(
    (citation) => !sourceChunkIds.has(citation.source_chunk_id),
  )) {
    return false;
  }
  const evidenceIds = new Set(
    request.learning_evidence.map((evidence) => evidence.evidence_id),
  );
  if (response.evidence_refs.some(
    (reference) => !evidenceIds.has(reference.evidence_id),
  )) {
    return false;
  }
  if (request.capability === "care" && !careOutputIsSafe([
    ...response.display_blocks.flatMap((block) => [block.title, block.content]),
    ...response.next_actions.map((action) => action.label),
    response.failure?.message ?? "",
    response.failure?.fallback_message ?? "",
  ])) {
    return false;
  }
  if (request.capability !== "diagnose") return true;
  return !possibleAnswerLeak(request, [
    ...response.display_blocks.map((block) => block.content),
    ...response.next_actions.map((action) => action.label),
    response.diagram ? JSON.stringify(response.diagram) : "",
  ].join("\n"));
}

function evidenceLabel(evidence: AiWorkflowRequest["learning_evidence"][number]) {
  if (evidence.summary.startsWith("当前确定性任务：")) return "当前任务依据";
  if (evidence.kind === "reading_progress") return "课程阅读记录";
  if (evidence.kind === "answer_result") return "真实作答记录";
  if (evidence.kind === "hint_usage") return "提示使用记录";
  return "学习任务依据";
}

export function convertModelWorkflowAnswer(
  request: AiWorkflowRequest,
  answer: ModelWorkflowAnswer,
  boundary?: ModelWorkflowBoundary,
): AiWorkflowResponse | null {
  if (answer.request_id !== request.request_id) return null;
  if (answer.status === "failed") {
    if (answer.failure_reasons.includes("context_incomplete")) {
      return workflowFailure(
        request,
        "insufficient_context",
        "CONTEXT_INCOMPLETE",
        "当前课程证据不足，AI 未生成推测性内容。",
        false,
      );
    }
    return workflowFailure(
      request,
      "failed",
      "WORKFLOW_FAILED",
      answer.failure_reasons.includes("hallucination_detected")
        ? "AI 工作流检测到内容可能越界，未展示。"
        : "AI 工作流拒绝了本次请求，未展示结果。",
      false,
    );
  }

  const references = [...new Set(answer.reference_ids)];
  const allowedReferenceIds = new Set(
    boundary?.allowedReferenceIds ?? request.source_chunk_ids,
  );
  const sourceById = new Map(
    request.context.source_chunks
      .filter((chunk) => allowedReferenceIds.has(chunk.source_chunk_id))
      .map((chunk) => [chunk.source_chunk_id, chunk]),
  );
  const hasUntraceableReference = references.some(
    (id) => !allowedReferenceIds.has(id) || !sourceById.has(id),
  );
  if (hasUntraceableReference && (boundary || request.capability !== "plan")) return null;
  const traceableReferences = references.filter((id) => sourceById.has(id));
  if (
    (request.capability !== "plan"
      && request.capability !== "care"
      && traceableReferences.length === 0)
    || answer.next_actions.length === 0
  ) {
    return null;
  }

  const upstreamBlocks = Array.isArray(answer.display_blocks)
    ? answer.display_blocks.map((block) => typeof block === "string"
      ? { kind: "explanation", content: block }
      : block)
    : [{ kind: "explanation", content: answer.display_blocks }];
  if (request.capability === "diagnose") {
    const hasFeedback = upstreamBlocks.some(
      (block) => block.kind === "feedback" && block.content.trim().length > 0,
    );
    const hasHint = upstreamBlocks.some(
      (block) => block.kind === "hint" && block.content.trim().length > 0,
    );
    if (!hasFeedback || !hasHint) return null;
  }
  const displayContent = upstreamBlocks.map((block) => block.content).join("\n\n");
  const actionContent = answer.next_actions
    .map((action) => typeof action === "string" ? action : action.label)
    .join("\n");
  if (
    request.capability === "diagnose"
    && possibleAnswerLeak(request, `${displayContent}\n${actionContent}`)
  ) return null;

  // A relay may return a valid action without explanatory text. Keep the
  // navigation useful for non-diagnostic slots, but never manufacture a
  // diagnosis without both feedback and hint content.
  if (upstreamBlocks.length === 0 && request.capability === "diagnose") return null;
  const normalizedDisplayContent = displayContent
    || (request.capability === "diagnose" ? "" : actionContent || workflowFallbackMessage(request.capability));

  const citations = traceableReferences.map((id, index) => {
    const chunk = sourceById.get(id)!;
    return {
      citation_id: `${request.request_id}_citation_${index + 1}`,
      source_chunk_id: id,
      label: `课程来源：${chunk.chapter}`.slice(0, 300),
      locator: chunk.locator,
    };
  });
  const allowedTargets = new Set(boundary?.allowedActionTargets ?? [
      request.course_id,
      request.concept_id,
      ...request.source_chunk_ids,
      request.context.care_check_in?.current_task.href ?? null,
    ].filter((value): value is string => value !== null));
  if (boundary && answer.next_actions.some((action) =>
    typeof action !== "string"
    && action.target !== null
    && action.target !== undefined
    && !allowedTargets.has(action.target)
  )) return null;
  const nextActions = answer.next_actions.map((action, index) => {
    const label = typeof action === "string" ? action : action.label;
    const upstreamKind = typeof action === "string" ? null : action.kind;
    const target = typeof action === "string" ? null : action.target ?? null;
    return {
      action_id: `${request.request_id}_action_${index + 1}`,
      kind: actionKind(label, upstreamKind),
      label,
      target: target && allowedTargets.has(target) ? target : null,
    };
  });
  const nextActionLabels = nextActions.map((action) => action.label);
  const evidenceRefs = request.capability === "plan"
    ? request.learning_evidence.slice(0, 2).map((evidence) => ({
        evidence_id: evidence.evidence_id,
        label: evidenceLabel(evidence),
        summary: evidence.summary,
      }))
    : [];
  const feedbackContent = upstreamBlocks
    .filter((block) => ["feedback", "explanation", "summary"].includes(block.kind))
    .map((block) => block.content)
    .join("\n\n") || displayContent;
  const hintContent = upstreamBlocks
    .filter((block) => ["hint", "question"].includes(block.kind))
    .map((block) => block.content)
    .join("\n\n") || nextActionLabels.join("；");
  const displayBlocks = request.capability === "diagnose"
    ? [
        {
          block_id: `${request.request_id}_feedback`,
          kind: "feedback" as const,
          title: "错因反馈",
          content: feedbackContent,
        },
        {
          block_id: `${request.request_id}_hint`,
          kind: "hint" as const,
          title: "下一步提示",
          content: hintContent,
        },
      ]
    : [{
        block_id: `${request.request_id}_summary`,
        kind: "summary" as const,
        title: capabilityTitle[request.capability],
        content: normalizedDisplayContent,
      }];
  const candidate: AiWorkflowResponse = {
    contract_version: "0.2",
    request_id: request.request_id,
    capability: request.capability,
    slot: request.slot,
    status: hasUntraceableReference ? "degraded" : "ready",
    display_blocks: displayBlocks,
    ...(request.visual_explanations && ["explain", "coach", "diagnose"].includes(request.capability) && answer.diagram
      ? { diagram: answer.diagram } : {}),
    citations,
    evidence_refs: evidenceRefs,
    next_actions: nextActions,
    failure: hasUntraceableReference
      ? {
          code: "WORKFLOW_FAILED",
          message: "AI 学习计划已生成，但其中的引用未能与当前课程片段对齐，已隐藏该引用。",
          retryable: false,
          fallback_message: workflowFallbackMessage(request.capability),
        }
      : null,
  };
  const parsed = aiWorkflowResponseSchema.safeParse(candidate);
  return parsed.success && workflowResponseIsSafe(request, parsed.data)
    ? parsed.data
    : null;
}

export function runtimeStatusForWorkflowResponse(
  response: AiWorkflowResponse,
  checkedAt = new Date().toISOString(),
): AiWorkflowRuntimeStatus {
  if (response.status === "ready") {
    const trace = response.model_trace;
    const detail = trace?.provider_model
      ? trace.matched
        ? `上游报告模型 ${trace.provider_model}，耗时 ${trace.latency_ms} ms。`
        : `上游报告模型 ${trace.provider_model}，与请求模型 ${trace.requested_model} 不一致；耗时 ${trace.latency_ms} ms。`
      : null;
    return {
      state: "available",
      label: "AI 学伴可用",
      detail,
      checked_at: checkedAt,
    };
  }
  if (response.status === "insufficient_context") {
    return {
      state: "degraded",
      label: "AI 服务需更多学习依据",
      detail: "最近一次请求缺少足够的课程或作答上下文，未生成推测性内容。",
      checked_at: checkedAt,
    };
  }
  if (response.status === "degraded") {
    return {
      state: "degraded",
      label: "AI 学伴有限可用",
      detail: "最近一次工作流调用返回了降级结果。",
      checked_at: checkedAt,
    };
  }
  return {
    state: "unavailable",
    label: "AI 服务暂不可用",
    detail: "最近一次工作流调用未成功，非 AI 学习流程仍可继续。",
    checked_at: checkedAt,
  };
}
