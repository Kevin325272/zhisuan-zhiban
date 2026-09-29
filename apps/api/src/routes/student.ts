import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  programmingLanguageSchema,
  traceVariantSchema,
  type AbilityAssessmentDimension,
} from "@xuetu/contracts";

import type { DemoState } from "../domain/demo-state.js";
import {
  createBfsTrace,
  InvalidTraceGraphError,
} from "../services/algorithm-trace.js";

const nodePresentation = {
  node_queue_001: {
    mastery_percent: 92,
    evidence_count: 4,
    weakness_count: 0,
    source_count: 2,
    position: { x: 12, y: 28 },
  },
  node_graph_repr_001: {
    mastery_percent: 84,
    evidence_count: 3,
    weakness_count: 1,
    source_count: 3,
    position: { x: 30, y: 42 },
  },
  node_graph_traversal_001: {
    mastery_percent: 58,
    evidence_count: 2,
    weakness_count: 1,
    source_count: 2,
    position: { x: 52, y: 25 },
  },
  node_bfs_001: {
    mastery_percent: 62,
    evidence_count: 3,
    weakness_count: 2,
    source_count: 2,
    position: { x: 52, y: 54 },
  },
  node_dfs_001: {
    mastery_percent: 18,
    evidence_count: 0,
    weakness_count: 0,
    source_count: 2,
    position: { x: 72, y: 30 },
  },
  node_shortest_001: {
    mastery_percent: 8,
    evidence_count: 0,
    weakness_count: 0,
    source_count: 2,
    position: { x: 72, y: 68 },
  },
  node_connected_001: {
    mastery_percent: 0,
    evidence_count: 0,
    weakness_count: 0,
    source_count: 1,
    position: { x: 90, y: 48 },
  },
} as const;

function success(requestId: string, data: unknown) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    data,
  };
}

function notFound(requestId: string, message: string) {
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

function badRequest(requestId: string, code: string, message: string) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: {
      code,
      message,
      retryable: false,
      details: {},
    },
  };
}

export function registerStudentRoutes(
  app: FastifyInstance,
  getState: (request: FastifyRequest) => DemoState,
) {
  app.get("/api/v1/student/overview", async (request) => {
    const state = getState(request);
    const recommendedNode = state.nodes.find(
      (node) => node.learning_node_id === state.course.current_node_id,
    );
    const bfsMastered = state.nodes.some(
      (node) => node.learning_node_id === "node_bfs_001" && node.status === "mastered",
    );

    return success(request.id, {
      student: state.student,
      current_course: state.course,
      recommended_node: recommendedNode,
      today_plan: bfsMastered
        ? [
            { label: "完成 BFS 独立验证", status: "completed" },
            { label: "比较 BFS 与 DFS", status: "in_progress" },
            { label: "实现递归 DFS", status: "not_started" },
          ]
        : [
            { label: "复习队列基础", status: "completed" },
            { label: "修复 BFS 代码", status: "in_progress" },
            { label: "完成独立验证", status: "not_started" },
          ],
      review_items: bfsMastered
        ? [
            {
              concept_id: "concept_graph_repr",
              label: "邻接表构建",
              evidence_label: "1 次错误",
              learning_node_id: "node_graph_repr_001",
            },
          ]
        : [
            {
              concept_id: "concept_bfs_visited",
              label: "visited 标记时机",
              evidence_label: "2 次错误",
              learning_node_id: "node_bfs_001",
            },
            {
              concept_id: "concept_graph_repr",
              label: "邻接表构建",
              evidence_label: "1 次错误",
              learning_node_id: "node_graph_repr_001",
            },
          ],
      recent_activity: [
        { label: "BFS 与 DFS 对比", occurred_at: "2026-07-21T12:20:00Z" },
        { label: "队列基础", occurred_at: "2026-07-21T10:15:00Z" },
      ],
    });
  });

  app.get<{ Params: { courseId: string } }>(
    "/api/v1/courses/:courseId/map",
    async (request, reply) => {
      const state = getState(request);
      if (request.params.courseId !== state.course.course_id) {
        return reply.code(404).send(notFound(request.id, "课程不存在。"));
      }

      const nodes = state.nodes.map((node) => {
        const presentation =
          nodePresentation[node.learning_node_id as keyof typeof nodePresentation];
        const masteryPercent =
          node.learning_node_id === "node_bfs_001"
            ? node.status === "mastered"
              ? 88
              : node.status === "validation_ready"
                ? 76
                : presentation.mastery_percent
            : presentation.mastery_percent;

        return {
          ...node,
          ...presentation,
          mastery_percent: masteryPercent,
        };
      });
      const edges = state.nodes.flatMap((node) =>
        node.prerequisite_node_ids.map((prerequisiteNodeId) => ({
          from_node_id: prerequisiteNodeId,
          to_node_id: node.learning_node_id,
          relation: "prerequisite" as const,
        })),
      );

      return success(request.id, {
        course: state.course,
        nodes,
        edges,
        recommended_node_id: state.course.current_node_id,
      });
    },
  );

  app.get<{
    Params: { taskId: string };
    Querystring: { language?: string; variant?: string; custom_input?: string };
  }>("/api/v1/tasks/:taskId/trace", async (request, reply) => {
    const state = getState(request);
    const task = state.tasks.get(request.params.taskId);
    if (!task) {
      return reply.code(404).send(notFound(request.id, "学习任务不存在。"));
    }

    const variant = traceVariantSchema.safeParse(request.query.variant);
    if (!variant.success) {
      return reply
        .code(400)
        .send(
          badRequest(
            request.id,
            "INVALID_TRACE_VARIANT",
            "运行轨迹版本必须是 visited-on-dequeue 或 visited-on-enqueue。",
          ),
        );
    }

    const language = programmingLanguageSchema.safeParse(
      request.query.language ?? task.language ?? "cpp",
    );
    if (!language.success) {
      return reply
        .code(400)
        .send(
          badRequest(
            request.id,
            "INVALID_PROGRAMMING_LANGUAGE",
            "运行轨迹语言不受支持。",
          ),
        );
    }

    try {
      return success(
        request.id,
        createBfsTrace(language.data, variant.data, request.query.custom_input),
      );
    } catch (caught) {
      if (caught instanceof InvalidTraceGraphError) {
        return reply
          .code(400)
          .send(badRequest(request.id, "INVALID_TRACE_GRAPH", caught.message));
      }
      throw caught;
    }
  });

  app.get<{ Params: { taskId: string } }>(
    "/api/v1/tasks/:taskId",
    async (request, reply) => {
      const state = getState(request);
      const task = state.tasks.get(request.params.taskId);
      if (!task) {
        return reply.code(404).send(notFound(request.id, "学习任务不存在。"));
      }

      return success(request.id, task);
    },
  );

  app.get<{ Params: { sourceId: string } }>(
    "/api/v1/sources/:sourceId",
    async (request, reply) => {
      const state = getState(request);
      const citation = state.citations.get(request.params.sourceId);
      if (!citation) {
        return reply.code(404).send(notFound(request.id, "课程来源不存在。"));
      }

      return success(request.id, citation);
    },
  );

  app.get<{ Querystring: { course_id?: string } }>(
    "/api/v1/practice/tasks",
    async (request, reply) => {
      const state = getState(request);
      if (request.query.course_id !== state.course.course_id) {
        return reply.code(404).send(notFound(request.id, "课程不存在。"));
      }

      const bfsNode = state.nodes.find((node) => node.learning_node_id === "node_bfs_001");

      return success(request.id, {
        course: state.course,
        items: Array.from(state.tasks.values()).map((task) => {
          const taskNode = state.nodes.find(
            (node) => node.learning_node_id === task.learning_node_id,
          );
          const taskStatus = taskNode?.status ?? "unknown";

          return {
            task_id: task.task_id,
            learning_node_id: task.learning_node_id,
            title: task.title,
            type: task.type,
            status: task.is_independent_validation
              ? taskStatus === "mastered" || taskStatus === "validation_ready"
                ? taskStatus
                : "not_started"
              : taskStatus,
            estimated_minutes: task.is_independent_validation ? 14 : 18,
            last_result:
              task.task_id === "task_bfs_bug_001"
                ? taskStatus === "mastered" || taskStatus === "validation_ready"
                  ? "4 / 4"
                  : "2 / 4"
                : null,
          };
        }),
      });
    },
  );

  app.get<{ Querystring: { course_id?: string } }>(
    "/api/v1/student/ability-assessment",
    async (request, reply) => {
      const state = getState(request);
      if (request.query.course_id !== state.course.course_id) {
        return reply.code(404).send(notFound(request.id, "课程不存在。"));
      }

      const bfsMastered = state.nodes.some(
        (node) => node.learning_node_id === "node_bfs_001" && node.status === "mastered",
      );
      const dimensions: AbilityAssessmentDimension[] = [
        {
          key: "knowledge_understanding",
          label: "知识理解",
          score: state.ability_scores.knowledge_understanding,
          target_score: 85,
          trend_delta: bfsMastered ? 10 : 4,
          evidence_count: bfsMastered ? 7 : 6,
          summary: "能够解释 BFS 分层访问机制及队列在遍历中的作用。",
          recommendation: "继续比较 BFS 与 DFS 的适用条件，并补充复杂度分析。",
        },
        {
          key: "algorithmic_thinking",
          label: "算法思维",
          score: state.ability_scores.algorithmic_thinking,
          target_score: 80,
          trend_delta: 6,
          evidence_count: 5,
          summary: "能够将图遍历问题拆成访问、扩展和去重三个步骤。",
          recommendation: "在非连通图与多源搜索中继续练习策略拆解。",
        },
        {
          key: "code_implementation",
          label: "代码实现",
          score: state.ability_scores.code_implementation,
          target_score: 78,
          trend_delta: bfsMastered ? 15 : -2,
          evidence_count: bfsMastered ? 7 : 5,
          summary: bfsMastered ? "已稳定修复访问状态维护问题。" : "访问状态维护仍不稳定。",
          recommendation: bfsMastered ? "继续完成 DFS 的递归与显式栈实现。" : "完成重复边和空图测试修复。",
        },
        {
          key: "debugging_diagnosis",
          label: "调试诊断",
          score: state.ability_scores.debugging_diagnosis,
          target_score: 76,
          trend_delta: bfsMastered ? 12 : 8,
          evidence_count: bfsMastered ? 6 : 4,
          summary: "能够沿运行轨迹定位重复入队的首次分叉位置。",
          recommendation: "继续练习从失败用例反推触发条件和错误机制。",
        },
        {
          key: "system_thinking",
          label: "系统思维",
          score: state.ability_scores.system_thinking,
          target_score: 72,
          trend_delta: 3,
          evidence_count: 3,
          summary: "开始关注数据结构、状态和模块行为之间的约束关系。",
          recommendation: "补充跨模块数据流与状态变化分析。",
        },
        {
          key: "transfer_application",
          label: "迁移应用",
          score: state.ability_scores.transfer_application,
          target_score: 75,
          trend_delta: bfsMastered ? 12 : 5,
          evidence_count: bfsMastered ? 5 : 4,
          summary: bfsMastered ? "已在无提示新图结构中完成迁移。" : "可在相似图结构中复用 BFS。",
          recommendation: bfsMastered ? "进入连通分量和多源最短路任务。" : "完成无提示最短路径迁移题。",
        },
      ];
      const overallScore = Math.round(
        dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length,
      );

      return success(request.id, {
        student_id: state.student.user_id,
        major: state.student.major,
        course_id: state.course.course_id,
        overall_score: overallScore,
        confidence: bfsMastered ? 92 : 86,
        evidence_count: dimensions.reduce((sum, dimension) => sum + dimension.evidence_count, 0),
        updated_at: "2026-07-23T10:30:00.000Z",
        dimensions,
      });
    },
  );

  app.get<{ Querystring: { course_id?: string } }>(
    "/api/v1/student/learning-profile",
    async (request, reply) => {
      const state = getState(request);
      if (request.query.course_id !== state.course.course_id) {
        return reply.code(404).send(notFound(request.id, "课程不存在。"));
      }

      const bfsMastered = state.nodes.some(
        (node) => node.learning_node_id === "node_bfs_001" && node.status === "mastered",
      );

      return success(request.id, {
        course_id: state.course.course_id,
        updated_at: state.course.updated_at,
        evidence_count: bfsMastered ? 12 : 9,
        dimensions: [
          {
            key: "conceptual_understanding",
            label: "概念理解",
            score: bfsMastered ? 88 : 82,
            summary: "能够解释 BFS 的分层访问机制。",
            evidence_count: bfsMastered ? 5 : 4,
          },
          {
            key: "code_implementation",
            label: "代码实现",
            score: bfsMastered ? 78 : 61,
            summary: bfsMastered ? "已修复访问状态维护问题。" : "访问状态维护仍不稳定。",
            evidence_count: bfsMastered ? 4 : 3,
          },
          {
            key: "transfer_application",
            label: "迁移应用",
            score: bfsMastered ? 74 : 56,
            summary: bfsMastered ? "已通过无提示迁移验证。" : "等待独立验证结果。",
            evidence_count: bfsMastered ? 3 : 2,
          },
        ],
        trend: [
          { date: "2026-07-16", score: 54 },
          { date: "2026-07-19", score: 61 },
          { date: "2026-07-22", score: bfsMastered ? 80 : 68 },
        ],
      });
    },
  );
}
