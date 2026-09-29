import { describe, expect, it } from "vitest";

import {
  abilityAssessmentSchema,
  agentEventSchema,
  algorithmTraceSchema,
  citationSchema,
  codeRunRequestSchema,
  codeRunResultSchema,
  courseMapSchema,
  diagnosisSchema,
  evaluationSchema,
  learningProfileSchema,
  learningNodeSchema,
  learningNodeStatusSchema,
  planItemSchema,
  practiceTaskSummarySchema,
  programmingLanguageSchema,
  questionAnswerSchema,
  submissionHistorySchema,
  taskSchema,
} from "../src/index.js";

describe("student MVP contracts", () => {
  it("accepts the eight supported programming languages only", () => {
    const supportedLanguages = [
      "c",
      "cpp",
      "java",
      "python",
      "javascript",
      "typescript",
      "go",
      "rust",
    ] as const;

    for (const language of supportedLanguages) {
      expect(programmingLanguageSchema.parse(language)).toBe(language);
    }
    expect(() => programmingLanguageSchema.parse("ruby")).toThrow();
  });

  it("validates a six-dimension evidence-backed ability assessment", () => {
    const dimensions = [
      { key: "knowledge_understanding", label: "知识理解", score: 82, target_score: 85, trend_delta: 4, evidence_count: 6, summary: "能够解释 BFS 分层访问机制。", recommendation: "继续比较 BFS 与 DFS 的适用条件。" },
      { key: "algorithmic_thinking", label: "算法思维", score: 74, target_score: 80, trend_delta: 6, evidence_count: 5, summary: "能够选择队列完成分层搜索。", recommendation: "补充复杂度与边界条件分析。" },
      { key: "code_implementation", label: "代码实现", score: 61, target_score: 78, trend_delta: -2, evidence_count: 5, summary: "访问状态维护仍不稳定。", recommendation: "完成重复边和空图测试修复。" },
      { key: "debugging_diagnosis", label: "调试诊断", score: 68, target_score: 76, trend_delta: 8, evidence_count: 4, summary: "能够沿运行轨迹定位重复入队。", recommendation: "练习从失败用例反推错误条件。" },
      { key: "system_thinking", label: "系统思维", score: 56, target_score: 72, trend_delta: 3, evidence_count: 3, summary: "开始关注模块关系与状态约束。", recommendation: "补充跨模块数据流分析。" },
      { key: "transfer_application", label: "迁移应用", score: 64, target_score: 75, trend_delta: 5, evidence_count: 4, summary: "可在相似图结构中复用 BFS。", recommendation: "完成无提示最短路径迁移题。" },
    ];
    const assessment = abilityAssessmentSchema.parse({
      student_id: "user_demo_001",
      major: "计算机科学与技术",
      course_id: "course_ds_001",
      overall_score: 68,
      confidence: 86,
      evidence_count: 27,
      updated_at: "2026-07-23T10:30:00.000Z",
      dimensions,
    });

    expect(assessment.dimensions).toHaveLength(6);
    expect(assessment.dimensions[3]?.key).toBe("debugging_diagnosis");
    expect(() => abilityAssessmentSchema.parse({
      ...assessment,
      dimensions: [
        { ...assessment.dimensions[0], score: 101 },
        ...assessment.dimensions.slice(1),
      ],
    })).toThrow();
  });

  it("accepts a valid learning node", () => {
    const node = learningNodeSchema.parse({
      learning_node_id: "node_bfs_001",
      course_id: "course_ds_001",
      concept_id: "concept_bfs",
      title: "广度优先遍历",
      status: "in_progress",
      prerequisite_node_ids: ["node_queue_001"],
      recommended_reason: "visited 标记时机理解不稳定。",
      completion_criteria: "完成代码任务并通过独立验证。",
      current_task_id: "task_bfs_bug_001",
    });

    expect(node.status).toBe("in_progress");
  });

  it("rejects an invented mastery state", () => {
    expect(() => learningNodeStatusSchema.parse("mastered_by_chat")).toThrow();
  });

  it("accepts the deterministic BFS task and evaluation", () => {
    const task = taskSchema.parse({
      task_id: "task_bfs_bug_001",
      learning_node_id: "node_bfs_001",
      type: "code",
      title: "修复 BFS 重复入队问题",
      prompt_markdown: "修复代码，使每个顶点只入队一次。",
      language: "cpp",
      starter_code: "void bfs() {}",
      code_templates: [
        {
          language: "cpp",
          file_name: "bfs.cpp",
          starter_code: "void bfs() {}",
          fixed_code: "void bfs() { /* fixed */ }",
        },
      ],
      time_limit_ms: 1000,
      memory_limit_mb: 128,
      allowed_hint_level: 2,
      is_independent_validation: false,
      version: 1,
    });
    const evaluation = evaluationSchema.parse({
      evaluation_id: "eval_001",
      submission_id: "sub_001",
      status: "completed",
      passed_count: 2,
      total_count: 4,
      score: 50,
      compiler_output: null,
      test_cases: [
        {
          test_case_id: "case_cycle_001",
          status: "failed",
          label: "含环图重复访问",
          summary: "顶点 3 被重复加入队列。",
          duration_ms: 14,
          memory_kb: 1832,
          input_visible: false,
          expected_visible: false,
        },
      ],
      completed_at: "2026-07-22T09:31:10Z",
    });

    expect(task.type).toBe("code");
    expect(evaluation.passed_count).toBe(2);

    const unavailableMetric = evaluationSchema.parse({
      ...evaluation,
      test_cases: [
        {
          ...evaluation.test_cases[0],
          status: "error",
          duration_ms: null,
          memory_kb: null,
        },
      ],
    });
    expect(unavailableMetric.test_cases[0]?.duration_ms).toBeNull();
    expect(unavailableMetric.test_cases[0]?.memory_kb).toBeNull();
  });

  it("requires evidence-backed diagnoses", () => {
    const diagnosis = diagnosisSchema.parse({
      diagnosis_id: "diag_001",
      run_id: "run_001",
      submission_id: "sub_001",
      concept_id: "concept_bfs_visited",
      observations: [
        {
          text: "测试 2、4 出现重复访问。",
          evidence_ids: ["evidence_test_001"],
        },
      ],
      primary_hypothesis: {
        code: "BFS_VISITED_TIMING",
        summary: "尚未稳定掌握访问标记的更新时机。",
        confidence: 0.86,
        confidence_level: "high",
        evidence_ids: ["evidence_test_001"],
      },
      alternative_hypotheses: [],
      citation_ids: ["source_ds_book_143"],
      next_action: {
        type: "hint",
        hint_level: 1,
        label: "观察入队前后的 visited 状态",
      },
      agent_version: "agent_diag_0.1.0",
      created_at: "2026-07-22T09:31:25Z",
    });

    expect(diagnosis.primary_hypothesis.evidence_ids).toContain("evidence_test_001");
    expect(() =>
      diagnosisSchema.parse({
        ...diagnosis,
        observations: [{ text: "没有证据", evidence_ids: [] }],
      }),
    ).toThrow();
  });

  it("accepts citations, plan items, and ordered agent events", () => {
    const citation = citationSchema.parse({
      source_id: "source_ds_book_143",
      document_id: "doc_ds_textbook_v1",
      title: "数据结构课程教材",
      section: "6.2.1 广度优先遍历",
      page: 143,
      paragraph: "p_06_02_01_04",
      snippet: "顶点入队时应立即标记为已访问。",
      relevance: 0.91,
      knowledge_base_version: "kb_ds_2026_07_20",
      viewer_url: "/api/v1/sources/source_ds_book_143",
    });
    const planItem = planItemSchema.parse({
      plan_item_id: "plan_item_003",
      learning_node_id: "node_bfs_001",
      position: 3,
      status: "in_progress",
      recommended_reason: "尚未完成独立验证。",
      completion_criteria: "独立验证首次通过。",
      based_on_diagnosis_ids: ["diag_001"],
    });
    const event = agentEventSchema.parse({
      run_id: "run_001",
      sequence: 1,
      type: "run.started",
      created_at: "2026-07-22T09:31:20Z",
      payload: { action_type: "diagnosis" },
    });

    expect(citation.relevance).toBeLessThanOrEqual(1);
    expect(planItem.position).toBe(3);
    expect(event.sequence).toBe(1);
  });

  it("keeps optional test-source metadata without breaking legacy citations", () => {
    const baseCitation = {
      source_id: "csdn_131792829_chunk_0002",
      document_id: "csdn_131792829",
      title: "BFS 测试文章",
      section: "测试来源 · 广度优先遍历",
      page: null,
      paragraph: null,
      snippet: "首次发现邻接点时标记并入队。",
      relevance: 0.93,
      knowledge_base_version: "test_ds_bfs_v1",
      viewer_url: "https://blog.csdn.net/example/article/details/131792829",
    };

    const legacy = citationSchema.parse(baseCitation);
    const testSource = citationSchema.parse({
      ...baseCitation,
      author: "测试作者",
      source_type: "test_fixture",
    });

    expect(legacy.author).toBeUndefined();
    expect(legacy.source_type).toBeUndefined();
    expect(testSource.author).toBe("测试作者");
    expect(testSource.source_type).toBe("test_fixture");
  });

  it("validates student redesign response contracts", () => {
    expect(
      practiceTaskSummarySchema.parse({
        task_id: "task_bfs_bug_001",
        learning_node_id: "node_bfs_001",
        title: "修复 BFS 重复入队问题",
        type: "code",
        status: "in_progress",
        estimated_minutes: 18,
        last_result: "2 / 4",
      }),
    ).toBeDefined();

    expect(
      learningProfileSchema.parse({
        course_id: "course_ds_001",
        updated_at: "2026-07-22T09:30:00.000Z",
        evidence_count: 9,
        dimensions: [
          {
            key: "conceptual_understanding",
            label: "概念理解",
            score: 82,
            summary: "能够解释 BFS 的分层访问机制。",
            evidence_count: 4,
          },
        ],
        trend: [{ date: "2026-07-22", score: 68 }],
      }),
    ).toBeDefined();

    expect(
      questionAnswerSchema.parse({
        answer_markdown: "BFS 按距离分层扩展顶点。",
        confidence_level: "high",
        citations: [],
        degraded: true,
        notice: "本次未找到可引用的课程来源。",
      }),
    ).toBeDefined();
  });

  it("validates knowledge graph and algorithm trace contracts", () => {
    const courseMap = courseMapSchema.parse({
      course: {
        course_id: "course_ds_001",
        title: "数据结构",
        description: "从结构理解到算法实现。",
        progress_percent: 42,
        current_node_id: "node_bfs_001",
        updated_at: "2026-07-22T09:30:00.000Z",
      },
      recommended_node_id: "node_bfs_001",
      nodes: [
        {
          learning_node_id: "node_bfs_001",
          course_id: "course_ds_001",
          concept_id: "concept_bfs",
          title: "广度优先遍历",
          status: "in_progress",
          prerequisite_node_ids: ["node_queue_001"],
          recommended_reason: "visited 标记时机理解不稳定。",
          completion_criteria: "完成代码任务并通过独立验证。",
          current_task_id: "task_bfs_bug_001",
          mastery_percent: 62,
          evidence_count: 3,
          weakness_count: 2,
          source_count: 2,
          position: { x: 52, y: 54 },
        },
      ],
      edges: [
        {
          from_node_id: "node_queue_001",
          to_node_id: "node_bfs_001",
          relation: "prerequisite",
        },
      ],
    });

    const trace = algorithmTraceSchema.parse({
      task_id: "task_bfs_bug_001",
      variant: "visited-on-dequeue",
      language: "cpp",
      file_name: "bfs.cpp",
      source_code: "void bfs() {}",
      graph: {
        nodes: [
          { node_id: "1", label: "1", position: { x: 12, y: 42 } },
          { node_id: "2", label: "2", position: { x: 40, y: 58 } },
        ],
        edges: [{ from_node_id: "1", to_node_id: "2" }],
      },
      steps: [
        {
          step_index: 0,
          code_line: 4,
          action: "节点 1 入队",
          explanation: "从起点开始遍历。",
          guiding_question: "起点应在什么时候标记访问？",
          current_node_id: "1",
          queue: ["1"],
          visited: [],
          output: [],
          newly_enqueued: ["1"],
          source_ids: ["source_ds_book_143"],
          conflict: null,
          prediction: {
            question: "执行下一步后，Queue 会变成什么？",
            options: [
              { option_id: "queue-empty", label: "空队列" },
              { option_id: "queue-one", label: "[1]" },
            ],
            correct_option_id: "queue-empty",
            explanation: "节点 1 将从队首出队。",
          },
        },
        {
          step_index: 1,
          code_line: 7,
          action: "节点 2 重复入队",
          explanation: "visited 标记过晚。",
          guiding_question: "如果入队时标记会怎样？",
          current_node_id: "2",
          queue: ["2", "2"],
          visited: ["1"],
          output: ["1", "2"],
          newly_enqueued: ["2"],
          source_ids: ["source_ds_book_143"],
          conflict: {
            code: "BFS_DUPLICATE_ENQUEUE",
            message: "节点 2 已在队列中但仍未标记访问。",
          },
          prediction: null,
        },
      ],
    });

    expect(courseMap.edges[0]?.relation).toBe("prerequisite");
    expect(trace.steps[1]?.conflict?.code).toBe("BFS_DUPLICATE_ENQUEUE");
    expect(trace.steps[0]?.output).toEqual([]);
    expect(trace.steps[0]?.prediction?.correct_option_id).toBe("queue-empty");

    const invalidFinalPrediction = algorithmTraceSchema.safeParse({
      ...trace,
      steps: trace.steps.map((step, index) =>
        index === trace.steps.length - 1
          ? {
              ...step,
              prediction: {
                question: "已经结束后还会发生什么？",
                options: [
                  { option_id: "stay", label: "保持不变" },
                  { option_id: "restart", label: "重新开始" },
                ],
                correct_option_id: "stay",
                explanation: "最终步骤不应继续提供预测题。",
              },
            }
          : step,
      ),
    });
    expect(invalidFinalPrediction.success).toBe(false);

    const invalidCorrectOption = algorithmTraceSchema.safeParse({
      ...trace,
      steps: trace.steps.map((step, index) =>
        index === 0 && step.prediction
          ? { ...step, prediction: { ...step.prediction, correct_option_id: "missing" } }
          : step,
      ),
    });
    expect(invalidCorrectOption.success).toBe(false);
  });

  it("validates source-driven code run requests and results", () => {
    const request = codeRunRequestSchema.parse({
      language: "cpp",
      source: "visited[next] = true;\npending.push(next);",
      custom_input: "1 2\n1 3\n2 4\n3 4",
    });
    const result = codeRunResultSchema.parse({
      run_id: "code_run_001",
      task_id: "task_bfs_bug_001",
      status: "passed",
      execution_mode: "sandbox",
      evaluator_label: "Judge0 · C++ 14.2",
      degraded_reason: null,
      language: "cpp",
      detected_variant: "visited-on-enqueue",
      passed_count: 4,
      total_count: 4,
      duration_ms: 18,
      memory_kb: 1740,
      stdout: "1 2 3 4",
      stderr: null,
      error_line: null,
      trace_available: true,
      trace_variant: "visited-on-enqueue",
      test_cases: [
        {
          test_case_id: "case_diamond",
          label: "菱形汇聚图",
          status: "passed",
          judge_status: "passed",
          input: "1 2\n1 3\n2 4\n3 4",
          expected_output: "1 2 3 4",
          actual_output: "1 2 3 4",
          summary: "每个顶点仅入队一次。",
          duration_ms: 4,
          memory_kb: 1740,
          stdout: "1 2 3 4\n",
          stderr: null,
        },
      ],
    });

    expect(request.custom_input).toContain("3 4");
    expect(result.execution_mode).toBe("sandbox");
    expect(result.evaluator_label).toContain("Judge0");
    expect(result.trace_variant).toBe("visited-on-enqueue");

    expect(
      codeRunResultSchema.parse({
        ...result,
        status: "runtime_error",
        passed_count: 0,
        duration_ms: null,
        memory_kb: null,
        stderr: "Segmentation fault",
        trace_available: false,
        trace_variant: null,
        test_cases: [
          {
            ...result.test_cases[0],
            status: "runtime_error",
            judge_status: "runtime_error",
            duration_ms: null,
            memory_kb: null,
            actual_output: "",
            stdout: "",
            stderr: "Segmentation fault",
          },
        ],
      }).test_cases[0],
    ).toMatchObject({
      status: "runtime_error",
      duration_ms: null,
      memory_kb: null,
    });

    expect(
      codeRunResultSchema.parse({
        ...result,
        execution_mode: "mock_fallback",
        evaluator_label: "演示评测",
        degraded_reason: "隔离沙箱暂时不可用。",
      }),
    ).toMatchObject({
      execution_mode: "mock_fallback",
      degraded_reason: "隔离沙箱暂时不可用。",
    });

    expect(
      codeRunResultSchema.parse({
        ...result,
        status: "compile_error",
        detected_variant: null,
        passed_count: 0,
        total_count: 0,
        stderr: "第 8 行：缺少右花括号。",
        error_line: 8,
        trace_available: false,
        trace_variant: null,
        test_cases: [],
      }).error_line,
    ).toBe(8);
  });

  it("validates immutable submission history snapshots", () => {
    const history = submissionHistorySchema.parse({
      task_id: "task_bfs_bug_001",
      items: [
        {
          submission_id: "sub_002",
          task_id: "task_bfs_bug_001",
          sequence: 2,
          created_at: "2026-07-22T09:31:02.000Z",
          code: {
            language: "cpp",
            source: "visited[next] = true;\npending.push(next);",
          },
          evaluation: {
            passed_count: 4,
            total_count: 4,
            score: 100,
          },
          diagnosis_id: null,
        },
      ],
    });

    expect(history.items[0]?.sequence).toBe(2);
    expect(history.items[0]?.code.source).toContain("visited[next]");
  });
});
