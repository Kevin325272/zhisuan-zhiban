import { z } from "zod";
import { learningDiagramSchema } from "./student-ai-preferences.js";
export * from "./student-ai-preferences.js";

export {
  STUDENT_CARE_CRISIS_GUIDANCE,
  studentCareCrisisSignalPresent,
} from "./student-care-safety.js";

const idSchema = z.string().min(1);
const isoDateTimeSchema = z.string().datetime();

export const learningNodeStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "needs_review",
  "validation_ready",
  "mastered",
  "unknown",
]);

export const taskTypeSchema = z.enum([
  "reading",
  "single_choice",
  "multiple_choice",
  "short_text",
  "code",
  "transfer_validation",
  "unknown",
]);

export const confidenceLevelSchema = z.enum(["low", "medium", "high", "unknown"]);

export const studentProfileSchema = z.object({
  user_id: idSchema,
  display_name: z.string().min(1),
  major: z.string().min(1),
  grade: z.string().min(1),
  avatar_url: z.string().url().nullable(),
});

export const courseSummarySchema = z.object({
  course_id: idSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  progress_percent: z.number().min(0).max(100),
  current_node_id: idSchema.nullable(),
  updated_at: isoDateTimeSchema,
});

export const learningNodeSchema = z.object({
  learning_node_id: idSchema,
  course_id: idSchema,
  concept_id: idSchema,
  title: z.string().min(1),
  status: learningNodeStatusSchema,
  prerequisite_node_ids: z.array(idSchema),
  recommended_reason: z.string().min(1).nullable(),
  completion_criteria: z.string().min(1),
  current_task_id: idSchema.nullable(),
});

export const graphPositionSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

export const courseMapNodeSchema = learningNodeSchema.extend({
  mastery_percent: z.number().min(0).max(100),
  evidence_count: z.number().int().nonnegative(),
  weakness_count: z.number().int().nonnegative(),
  source_count: z.number().int().nonnegative(),
  position: graphPositionSchema,
});

export const courseMapEdgeSchema = z.object({
  from_node_id: idSchema,
  to_node_id: idSchema,
  relation: z.literal("prerequisite"),
});

export const courseMapSchema = z.object({
  course: courseSummarySchema,
  nodes: z.array(courseMapNodeSchema),
  edges: z.array(courseMapEdgeSchema),
  recommended_node_id: idSchema,
});

export const programmingLanguageIds = [
  "c",
  "cpp",
  "java",
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
] as const;

export const programmingLanguageSchema = z.enum(programmingLanguageIds);

export const programmingLanguageMeta = {
  c: { label: "C", version: "C17", file_name: "bfs.c", prism_language: "c" },
  cpp: { label: "C++", version: "C++17", file_name: "bfs.cpp", prism_language: "cpp" },
  java: { label: "Java", version: "Java 17", file_name: "BfsTraversal.java", prism_language: "java" },
  python: { label: "Python", version: "Python 3.12", file_name: "bfs.py", prism_language: "python" },
  javascript: { label: "JavaScript", version: "ES2023", file_name: "bfs.js", prism_language: "javascript" },
  typescript: { label: "TypeScript", version: "TypeScript 5", file_name: "bfs.ts", prism_language: "typescript" },
  go: { label: "Go", version: "Go 1.22", file_name: "bfs.go", prism_language: "go" },
  rust: { label: "Rust", version: "Rust 2021", file_name: "bfs.rs", prism_language: "rust" },
} as const satisfies Record<
  (typeof programmingLanguageIds)[number],
  { label: string; version: string; file_name: string; prism_language: string }
>;

export const codeTemplateSchema = z.object({
  language: programmingLanguageSchema,
  file_name: z.string().min(1),
  starter_code: z.string().min(1),
  // 独立验证任务不下发参考实现，避免泄露答案。
  fixed_code: z.string().min(1).optional(),
});

export const taskSchema = z.object({
  task_id: idSchema,
  learning_node_id: idSchema,
  type: taskTypeSchema,
  title: z.string().min(1),
  prompt_markdown: z.string().min(1),
  language: programmingLanguageSchema.nullable(),
  starter_code: z.string().nullable(),
  code_templates: z.array(codeTemplateSchema).min(1).optional(),
  time_limit_ms: z.number().int().positive().nullable(),
  memory_limit_mb: z.number().int().positive().nullable(),
  allowed_hint_level: z.number().int().min(0).max(3),
  is_independent_validation: z.boolean(),
  version: z.number().int().positive(),
});

export const testCaseResultSchema = z.object({
  test_case_id: idSchema,
  status: z.enum(["passed", "failed", "error"]),
  label: z.string().min(1),
  summary: z.string().min(1),
  duration_ms: z.number().int().nonnegative().nullable(),
  memory_kb: z.number().int().nonnegative().nullable(),
  input_visible: z.boolean(),
  expected_visible: z.boolean(),
});

export const evaluationSchema = z.object({
  evaluation_id: idSchema,
  submission_id: idSchema,
  status: z.enum(["queued", "running", "completed", "failed"]),
  passed_count: z.number().int().nonnegative(),
  total_count: z.number().int().positive(),
  score: z.number().min(0).max(100),
  compiler_output: z.string().nullable(),
  test_cases: z.array(testCaseResultSchema),
  completed_at: isoDateTimeSchema.nullable(),
});

export const evidenceSchema = z.object({
  evidence_id: idSchema,
  type: z.enum([
    "test_result",
    "compiler_output",
    "submission_diff",
    "answer_choice",
    "hint_usage",
    "baseline_result",
    "validation_result",
    "rag_source",
    "unknown",
  ]),
  label: z.string().min(1),
  summary: z.string().min(1),
  source_ref: idSchema,
  created_at: isoDateTimeSchema,
});

export const citationSchema = z.object({
  source_id: idSchema,
  document_id: idSchema,
  title: z.string().min(1),
  author: z.string().min(1).optional(),
  source_type: z.enum(["course_material", "test_fixture"]).optional(),
  section: z.string().min(1),
  page: z.number().int().positive().nullable(),
  paragraph: z.string().min(1).nullable(),
  snippet: z.string().min(1),
  relevance: z.number().min(0).max(1),
  knowledge_base_version: z.string().min(1),
  viewer_url: z.string().min(1),
});

export const observationSchema = z.object({
  text: z.string().min(1),
  evidence_ids: z.array(idSchema).min(1),
});

export const hypothesisSchema = z.object({
  code: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  confidence_level: confidenceLevelSchema,
  evidence_ids: z.array(idSchema).min(1),
});

export const nextActionSchema = z.object({
  type: z.enum(["hint", "clarifying_question", "validation", "review"]),
  hint_level: z.number().int().min(0).max(3).nullable(),
  label: z.string().min(1),
});

export const diagnosisSchema = z.object({
  diagnosis_id: idSchema,
  run_id: idSchema,
  submission_id: idSchema,
  concept_id: idSchema,
  observations: z.array(observationSchema).min(1),
  primary_hypothesis: hypothesisSchema,
  alternative_hypotheses: z.array(hypothesisSchema),
  citation_ids: z.array(idSchema),
  next_action: nextActionSchema,
  agent_version: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export const planItemSchema = z.object({
  plan_item_id: idSchema,
  learning_node_id: idSchema,
  position: z.number().int().positive(),
  status: learningNodeStatusSchema,
  recommended_reason: z.string().min(1),
  completion_criteria: z.string().min(1),
  based_on_diagnosis_ids: z.array(idSchema),
});

export const agentEventTypeSchema = z.enum([
  "run.started",
  "stage.started",
  "stage.completed",
  "retrieval.completed",
  "assistant.delta",
  "diagnosis.completed",
  "recommendation.completed",
  "run.completed",
  "run.failed",
]);

export const agentEventSchema = z.object({
  run_id: idSchema,
  sequence: z.number().int().positive(),
  type: agentEventTypeSchema,
  created_at: isoDateTimeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const practiceTaskSummarySchema = z.object({
  task_id: idSchema,
  learning_node_id: idSchema,
  title: z.string().min(1),
  type: taskTypeSchema,
  status: learningNodeStatusSchema,
  estimated_minutes: z.number().int().positive(),
  last_result: z.string().min(1).nullable(),
});

export const abilityDimensionSchema = z.object({
  key: z.enum(["conceptual_understanding", "code_implementation", "transfer_application"]),
  label: z.string().min(1),
  score: z.number().min(0).max(100).nullable(),
  summary: z.string().min(1),
  evidence_count: z.number().int().nonnegative(),
});

export const learningProfileSchema = z.object({
  course_id: idSchema,
  updated_at: isoDateTimeSchema,
  evidence_count: z.number().int().nonnegative(),
  dimensions: z.array(abilityDimensionSchema),
  trend: z.array(
    z.object({
      date: z.string().date(),
      score: z.number().min(0).max(100),
    }),
  ),
});

export const abilityAssessmentKeySchema = z.enum([
  "knowledge_understanding",
  "algorithmic_thinking",
  "code_implementation",
  "debugging_diagnosis",
  "system_thinking",
  "transfer_application",
]);

export const abilityAssessmentDimensionSchema = z.object({
  key: abilityAssessmentKeySchema,
  label: z.string().min(1),
  score: z.number().min(0).max(100),
  target_score: z.number().min(0).max(100),
  trend_delta: z.number().min(-100).max(100),
  evidence_count: z.number().int().nonnegative(),
  summary: z.string().min(1),
  recommendation: z.string().min(1),
});

export const abilityAssessmentSchema = z.object({
  student_id: idSchema,
  major: z.string().min(1),
  course_id: idSchema,
  overall_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  evidence_count: z.number().int().nonnegative(),
  updated_at: isoDateTimeSchema,
  dimensions: z.array(abilityAssessmentDimensionSchema).length(6),
});

export const questionAnswerSchema = z.object({
  answer_markdown: z.string().min(1),
  confidence_level: confidenceLevelSchema,
  citations: z.array(citationSchema),
  degraded: z.boolean(),
  notice: z.string().min(1).nullable(),
});

export const traceVariantSchema = z.enum(["visited-on-dequeue", "visited-on-enqueue"]);

export const traceGraphSchema = z.object({
  nodes: z.array(
    z.object({
      node_id: idSchema,
      label: z.string().min(1),
      position: graphPositionSchema,
    }),
  ),
  edges: z.array(
    z.object({
      from_node_id: idSchema,
      to_node_id: idSchema,
    }),
  ),
});

const algorithmTracePredictionSchema = z.object({
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        option_id: idSchema,
        label: z.string().min(1),
      }),
    )
    .min(2)
    .max(4),
  correct_option_id: idSchema,
  explanation: z.string().min(1),
});

export const algorithmTraceStepSchema = z.object({
  step_index: z.number().int().nonnegative(),
  code_line: z.number().int().positive(),
  action: z.string().min(1),
  explanation: z.string().min(1),
  guiding_question: z.string().min(1),
  current_node_id: idSchema.nullable(),
  queue: z.array(idSchema),
  visited: z.array(idSchema),
  output: z.array(idSchema),
  newly_enqueued: z.array(idSchema),
  source_ids: z.array(idSchema),
  conflict: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .nullable(),
  prediction: algorithmTracePredictionSchema.nullable(),
});

export const algorithmTraceSchema = z
  .object({
    task_id: idSchema,
    variant: traceVariantSchema,
    language: programmingLanguageSchema,
    file_name: z.string().min(1),
    source_code: z.string().min(1),
    graph: traceGraphSchema,
    steps: z.array(algorithmTraceStepSchema).min(1),
  })
  .superRefine((trace, context) => {
    trace.steps.forEach((step, index) => {
      if (
        step.prediction &&
        !step.prediction.options.some(
          (option) => option.option_id === step.prediction?.correct_option_id,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "预测题的正确答案必须存在于选项中。",
          path: ["steps", index, "prediction", "correct_option_id"],
        });
      }
    });

    const finalStepIndex = trace.steps.length - 1;
    if (trace.steps[finalStepIndex]?.prediction !== null) {
      context.addIssue({
        code: "custom",
        message: "最终轨迹步骤不能继续提供预测题。",
        path: ["steps", finalStepIndex, "prediction"],
      });
    }
  });

export const codeRunRequestSchema = z.object({
  language: programmingLanguageSchema,
  source: z.string().min(1).max(20_000),
  custom_input: z.string().max(4_000).nullable(),
});

export const executionModeSchema = z.enum(["sandbox", "mock", "mock_fallback"]);

export const codeRunCaseStatusSchema = z.enum([
  "passed",
  "failed",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "internal_error",
]);

export const codeRunTestCaseSchema = z.object({
  test_case_id: idSchema,
  label: z.string().min(1),
  status: codeRunCaseStatusSchema,
  judge_status: codeRunCaseStatusSchema,
  input: z.string(),
  expected_output: z.string(),
  actual_output: z.string(),
  summary: z.string().min(1),
  duration_ms: z.number().int().nonnegative().nullable(),
  memory_kb: z.number().int().nonnegative().nullable(),
  stdout: z.string(),
  stderr: z.string().nullable(),
});

export const codeRunResultSchema = z.object({
  run_id: idSchema,
  task_id: idSchema,
  status: z.enum([
    "passed",
    "failed",
    "compile_error",
    "runtime_error",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "internal_error",
  ]),
  execution_mode: executionModeSchema,
  evaluator_label: z.string().min(1),
  degraded_reason: z.string().min(1).nullable(),
  language: programmingLanguageSchema,
  detected_variant: traceVariantSchema.nullable(),
  passed_count: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative().nullable(),
  memory_kb: z.number().int().nonnegative().nullable(),
  stdout: z.string(),
  stderr: z.string().nullable(),
  error_line: z.number().int().positive().nullable(),
  trace_available: z.boolean(),
  trace_variant: traceVariantSchema.nullable(),
  test_cases: z.array(codeRunTestCaseSchema),
});

export const programmingExperimentDefinitionSchema = z.object({
  experiment_id: idSchema,
  course_id: idSchema,
  course_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  concept_id: idSchema,
  task_id: idSchema,
  title: z.string().min(1).max(160),
  subtitle: z.string().min(1).max(160),
  learning_objective: z.string().min(10).max(600),
  prompt: z.string().min(10).max(2_000),
  requirements: z.array(z.string().min(1).max(300)).min(1).max(8),
  success_criteria: z.array(z.string().min(1).max(300)).min(1).max(8),
  language: z.literal("cpp"),
  starter_code: z.string().min(1).max(20_000),
  data_boundary: z.string().min(1).max(500),
}).strict();

export const programmingExperimentAttemptSubmitSchema = z.object({
  language: z.literal("cpp"),
  source: z.string().min(1).max(20_000),
  custom_input: z.string().max(4_000).nullable(),
}).strict();

export const programmingExperimentDiagnosisSchema = z.object({
  status: z.enum(["passed", "needs_revision", "compile_error", "execution_error"]),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1_000),
  evidence: z.array(z.string().min(1).max(500)).max(10),
  correction_goal: z.string().min(1).max(500),
  next_action: z.enum(["retry", "review_concept", "continue_course"]),
}).strict();

const persistedProgrammingExperimentResultSchema = codeRunResultSchema.extend({
  execution_mode: z.literal("sandbox"),
  degraded_reason: z.null(),
});

export const programmingExperimentAttemptRecordSchema = z.object({
  attempt_id: idSchema,
  experiment_id: idSchema,
  course_id: idSchema,
  concept_id: idSchema,
  task_id: idSchema,
  language: z.literal("cpp"),
  source: z.string().min(1).max(20_000),
  result: persistedProgrammingExperimentResultSchema,
  diagnosis: programmingExperimentDiagnosisSchema,
  created_at: isoDateTimeSchema,
}).strict();

export const programmingExperimentHistorySchema = z.object({
  items: z.array(programmingExperimentAttemptRecordSchema).max(50),
  total: z.number().int().nonnegative(),
}).strict();

export const programmingExperimentOverviewSchema = z.object({
  definition: programmingExperimentDefinitionSchema,
  latest_attempt: programmingExperimentAttemptRecordSchema.nullable(),
  attempt_count: z.number().int().nonnegative(),
}).strict();

export const programmingExperimentCatalogSchema = z.object({
  items: z.array(programmingExperimentOverviewSchema).max(50),
}).strict();

export const tutorHintLevelSchema = z.enum(["direction", "clue", "steps", "complete"]);

export const tutorRequestedActionSchema = z.enum([
  "diagnosis",
  "explanation",
  "recommendation",
  "question_answer",
]);

export const agentMockScenarioSchema = z.enum([
  "auto",
  "normal",
  "rag_empty",
  "rag_low_confidence",
  "agent_timeout",
]);

// 工作台上下文是辅助信息：允许调用方只带部分字段，缺省的补 null / 空数组。
export const tutorWorkspaceContextSchema = z.object({
  active_view: z.enum(["code", "trace", "tests", "evidence", "history", "ask"]),
  language: z.string().max(40).nullish().default(null),
  task_title: z.string().max(200).nullish().default(null),
  task_id: z.string().max(120).nullish().default(null),
  learning_node_id: z.string().max(120).nullish().default(null),
  submission_id: z.string().max(120).nullish().default(null),
  code_excerpt: z.string().max(8_000).nullish().default(null),
  test_summary: z.string().max(2_000).nullish().default(null),
  trace_summary: z.string().max(2_000).nullish().default(null),
  error_line: z.number().int().positive().nullish().default(null),
  selected_test_case_id: z.string().max(120).nullish().default(null),
  failed_test_cases: z.array(z.string().max(400)).max(20).default([]),
  execution_mode: z.enum(["sandbox", "mock", "mock_fallback"]).nullish().default(null),
  evaluator_label: z.string().max(200).nullish().default(null),
  runtime_summary: z.array(z.string().max(300)).max(20).default([]),
  evaluator_error: z.string().max(2_000).nullish().default(null),
  trace_variant: z.string().max(60).nullish().default(null),
  learner_weak_points: z.array(z.string().max(300)).max(20).default([]),
});

export const learningSessionRequestSchema = z.object({
  course_id: idSchema,
  learning_node_id: idSchema,
  task_id: idSchema,
  mode: z.literal("guided_learning"),
});

export const agentMessageRequestSchema = z.object({
  content: z.string().min(1).max(4_000),
  submission_id: idSchema.nullable(),
  requested_action: tutorRequestedActionSchema,
  mock_scenario: agentMockScenarioSchema.optional(),
  hint_level: tutorHintLevelSchema.optional(),
  workspace_context: tutorWorkspaceContextSchema.nullable().optional(),
});

export const submissionRequestSchema = z.object({
  task_version: z.number().int().positive(),
  answer: z.null(),
  code: z.object({
    language: programmingLanguageSchema,
    source: z.string().min(1).max(20_000),
  }),
  custom_input: z.string().max(4_000).nullable().optional(),
  client_draft_version: z.number().int().nonnegative(),
  hint_usage_ids: z.array(idSchema).max(50),
  // 兼容旧客户端保留；服务端不再依据此字段判定任何结果。
  mock_answer_variant: z.string().max(60).optional(),
});

export const validationAttemptRequestSchema = z.object({
  task_version: z.number().int().positive(),
  expected_learning_state_version: z.number().int().nonnegative(),
  answer: z.null(),
  code: z.object({
    language: programmingLanguageSchema,
    source: z.string().min(1).max(20_000),
  }),
});

export const submissionHistoryItemSchema = z.object({
  submission_id: idSchema,
  task_id: idSchema,
  sequence: z.number().int().positive(),
  created_at: isoDateTimeSchema,
  code: z.object({
    language: programmingLanguageSchema,
    source: z.string().min(1),
  }),
  evaluation: z.object({
    passed_count: z.number().int().nonnegative(),
    total_count: z.number().int().positive(),
    score: z.number().min(0).max(100),
  }),
  diagnosis_id: idSchema.nullable(),
});

export const submissionHistorySchema = z.object({
  task_id: idSchema,
  items: z.array(submissionHistoryItemSchema),
});

export const platformRoleSchema = z.enum(["student", "teacher", "admin"]);

export const accountStatusSchema = z.enum(["active", "pending_approval", "disabled"]);
export const authSourceSchema = z.enum(["local_development", "external_identity"]);

// Account/auth contracts intentionally model only data that is safe to cross
// the browser boundary. Password hashes, raw session tokens and internal
// session identifiers are never part of these DTOs.
//
// Keep one identity form across browser input, service lookup and storage.
// NFKC also folds compatibility forms such as full-width Latin characters.
export function canonicalizeUsername(value: string) {
  return value.trim().normalize("NFKC").toLowerCase();
}

const usernameSchema = z
  .string()
  .regex(/^[^\s\p{C}]{1,32}$/u)
  .refine(
    (value) => value === canonicalizeUsername(value),
    "用户名必须使用规范化小写形式。",
  );
const usernameInputSchema = z
  .string()
  .max(100)
  .transform(canonicalizeUsername)
  .pipe(usernameSchema);
const passwordInputSchema = z
  .string()
  .min(6)
  .max(128)
  .refine((value) => !/\s/u.test(value), "密码不能包含空白字符。");
const passwordConfirmationSchema = z.string().min(1).max(128);
const accountOriginSchema = z.enum(["legacy_demo", "registered", "seeded_admin"]);
const accountDataBoundarySchema = z.enum(["legacy_demo", "local_account"]);

export const authRegisterRequestSchema = z
  .object({
    role: z.enum(["student", "teacher"]),
    username: usernameInputSchema,
    display_name: z.string().trim().min(1).max(100),
    password: passwordInputSchema,
    password_confirmation: passwordConfirmationSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.password !== input.password_confirmation) {
      context.addIssue({
        code: "custom",
        path: ["password_confirmation"],
        message: "两次输入的密码不一致。",
      });
    }
  });

export const authLoginRequestSchema = z
  .object({
    username: usernameInputSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const authAccountSchema = z
  .object({
    user_id: idSchema,
    username: usernameSchema,
    display_name: z.string().min(1).max(100),
    account_status: accountStatusSchema,
    roles: z.array(platformRoleSchema).min(1).max(3),
    auth_source: authSourceSchema,
    account_origin: accountOriginSchema,
    data_boundary: accountDataBoundarySchema,
    must_change_password: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    last_login_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const authRegistrationResponseSchema = z
  .object({
    account: authAccountSchema,
    authenticated: z.boolean(),
    next_step: z.enum(["student_onboarding", "await_teacher_approval"]),
  })
  .strict()
  .superRefine((input, context) => {
    const pendingTeacher = input.account.account_status === "pending_approval"
      && input.account.roles.includes("teacher");
    if (input.next_step === "await_teacher_approval" && (!pendingTeacher || input.authenticated)) {
      context.addIssue({
        code: "custom",
        path: ["next_step"],
        message: "教师待审核响应必须对应未认证的待审核教师账户。",
      });
    }
    if (input.next_step === "student_onboarding"
      && (!input.account.roles.includes("student") || !input.authenticated)) {
      context.addIssue({
        code: "custom",
        path: ["next_step"],
        message: "学生起步设置响应必须对应已认证学生账户。",
      });
    }
  });

export const accountCreateRequestSchema = z
  .object({
    username: usernameInputSchema,
    display_name: z.string().trim().min(1).max(100),
    password: passwordInputSchema,
    role: z.enum(["student", "teacher", "admin"]),
  })
  .strict();

export const accountStatusUpdateSchema = z
  .object({ status: z.enum(["active", "disabled"]) })
  .strict();

export const adminPasswordResetRequestSchema = z
  .object({ password: passwordInputSchema })
  .strict();

export const teacherApprovalRequestSchema = z
  .object({
    teacher_number: z.string().trim().min(4).max(32),
    department: z.string().trim().min(1).max(120),
    professional_title: z.string().trim().min(1).max(50),
    course_id: idSchema,
    class_ids: z.array(idSchema).min(1).max(50),
  })
  .strict();

export const academicClassOptionSchema = z
  .object({
    class_id: idSchema,
    cohort_year: z.number().int().min(2000).max(2100),
    major: z.string().min(1).max(100),
    class_name: z.string().min(1).max(100),
  })
  .strict();

export const academicClassOptionListSchema = z
  .object({ items: z.array(academicClassOptionSchema).max(500) })
  .strict();

export const passwordChangeRequestSchema = z
  .object({
    current_password: z.string().min(1).max(128),
    new_password: passwordInputSchema,
    new_password_confirmation: passwordConfirmationSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.new_password !== input.new_password_confirmation) {
      context.addIssue({
        code: "custom",
        path: ["new_password_confirmation"],
        message: "两次输入的新密码不一致。",
      });
    }
  });

export const authSessionResponseSchema = z
  .object({ account: authAccountSchema })
  .strict();

export const accountListResponseSchema = z
  .object({ items: z.array(authAccountSchema).max(500) })
  .strict();

export const studentRegistrationPolicySchema = z
  .object({
    mode: z.enum(["self_service", "controlled"]),
    self_registration: z.boolean(),
    teacher_registration: z.literal("approval_required"),
    course_ids: z.array(idSchema).min(1).max(20),
    notice: z.string().min(1).max(300),
  })
  .strict();

export const accountCourseScopeItemSchema = z
  .object({
    course_id: idSchema,
    course_code: z.string().min(1).max(50),
    title: z.string().min(1).max(200),
  })
  .strict();

export const accountCourseScopeSchema = z
  .object({
    items: z.array(accountCourseScopeItemSchema).max(20),
    visibility: z.literal("active_memberships_only"),
  })
  .strict();

export const platformUserSchema = z
  .object({
    user_id: idSchema,
    display_name: z.string().min(1).max(100),
    account_status: accountStatusSchema,
    auth_source: authSourceSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const courseStatusSchema = z.enum(["draft", "active", "archived"]);

export const courseRecordSchema = z
  .object({
    course_id: idSchema,
    course_code: z.string().min(1).max(40),
    title: z.string().min(1).max(200),
    discipline: z.string().min(1).max(100),
    status: courseStatusSchema,
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const courseMembershipSchema = z
  .object({
    course_id: idSchema,
    user_id: idSchema,
    membership_role: z.enum(["student", "teacher"]),
    status: z.enum(["active", "inactive"]),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const courseMaterialStatusSchema = z.enum(["available", "pending"]);

export const courseContentBoundarySchema = z
  .object({
    usage_scope: z.literal("local_demo_only"),
    license_status: z.literal("unverified"),
    provenance_status: z.enum(["source_unknown_unverified", "not_ingested"]),
    notice: z.string().min(1).max(500),
  })
  .strict();

export const courseCatalogItemSchema = z
  .object({
    course_id: idSchema,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    course_code: z.string().min(1).max(40),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(500),
    question_subject: z.string().min(1).max(100),
    display_order: z.number().int().positive(),
    question_count: z.number().int().nonnegative(),
    material_status: courseMaterialStatusSchema,
    knowledge_chunk_count: z.number().int().nonnegative(),
    core_concept_count: z.number().int().nonnegative(),
    qa_example_count: z.number().int().nonnegative(),
    chapter_count: z.number().int().nonnegative(),
    source_boundary: courseContentBoundarySchema,
  })
  .strict()
  .superRefine((course, context) => {
    if (
      course.material_status === "pending" &&
      (
        course.knowledge_chunk_count > 0
        || course.core_concept_count > 0
        || course.qa_example_count > 0
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Pending course materials cannot expose imported content counts.",
        path: ["material_status"],
      });
    }
  });

export const courseRecommendedStartSchema = z
  .object({
    course_slug: idSchema,
    chunk_id: idSchema,
    chapter: z.string().min(1).max(300),
    page: z.number().int().positive(),
    basis: z.literal("first_available_content"),
  })
  .strict();

export const courseCatalogResponseSchema = z
  .object({
    courses: z.array(courseCatalogItemSchema).min(1).max(20),
    recommended_start: courseRecommendedStartSchema.nullable(),
    generated_at: isoDateTimeSchema,
  })
  .strict();

export const sourceLayerStudentContentStatusSchema = z.enum([
  "source_layer_only_curriculum_pending",
  "curriculum_available",
]);

export const sourceLayerCourseSummarySchema = z
  .object({
    course_id: idSchema,
    title: z.string().min(1).max(300),
    course_label: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    isbn: z.string().min(1).max(50),
    source_archive_file: z.string().min(1).max(300),
    source_archive_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    source_files: z.array(z.string().min(1)).min(1),
    chunk_count: z.number().int().nonnegative(),
    chapter_count: z.number().int().nonnegative(),
    figure_count: z.number().int().nonnegative(),
    image_available_count: z.number().int().nonnegative(),
    needs_human_review_figure_count: z.number().int().nonnegative(),
    chunk_review_count: z.number().int().nonnegative(),
    student_content_status: sourceLayerStudentContentStatusSchema,
    license_status: z.literal("unverified"),
    usage_scope: z.literal("local_demo_only"),
  })
  .strict();

export const sourceCourseCurriculumStatusSchema = z.literal(
  "source_structure_available_curriculum_pending",
);

export const sourceCourseFigureSchema = z
  .object({
    figure_label: z.string().regex(/^图\d{1,2}\.\d{1,3}$/u),
    caption: z.string().trim().min(1).max(300),
    image_url: z.string().regex(
      /^\/api\/v1\/408\/courses\/[a-z0-9]+(?:-[a-z0-9]+)*\/source-figures\/[a-zA-Z0-9_-]+$/u,
    ),
    mime_type: z.literal("image/webp"),
    pixel_width: z.number().int().positive().max(10_000),
    pixel_height: z.number().int().positive().max(10_000),
  })
  .strict();

export const sourceCourseEntrySchema = z
  .object({
    entry_id: idSchema,
    title: z.string().trim().min(1).max(300),
    print_page: z.number().int().positive(),
    keywords: z.array(z.string().trim().min(1).max(80)).max(8),
    figure: sourceCourseFigureSchema.nullable(),
  })
  .strict();

export const sourceCourseChapterSchema = z
  .object({
    chapter: z.string().trim().min(1).max(300),
    ordinal: z.number().int().nonnegative(),
    source_entry_count: z.number().int().positive(),
    page_start: z.number().int().positive(),
    page_end: z.number().int().positive(),
    entries: z.array(sourceCourseEntrySchema).max(6),
  })
  .strict()
  .refine((chapter) => chapter.page_end >= chapter.page_start, {
    message: "Source course chapter page range must be ordered.",
    path: ["page_end"],
  });

export const sourceCourseOutlineSchema = z
  .object({
    course_id: idSchema,
    course_slug: idSchema,
    course_code: z.string().trim().min(1).max(50),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(1_000),
    question_subject: z.string().trim().min(1).max(100),
    source_title: z.string().trim().min(1).max(300),
    source_edition: z.string().trim().min(1).max(100),
    curriculum_status: sourceCourseCurriculumStatusSchema,
    notice: z.literal("课程结构已接入，讲解内容待课程化整理。"),
    chapter_count: z.number().int().positive(),
    source_entry_count: z.number().int().positive(),
    displayable_figure_count: z.number().int().nonnegative(),
    chapters: z.array(sourceCourseChapterSchema).min(1).max(30),
  })
  .strict();

export const courseChapterSchema = z
  .object({
    chapter: z.string().min(1).max(300),
    chunk_count: z.number().int().positive(),
    page_start: z.number().int().positive(),
    page_end: z.number().int().positive(),
    first_chunk_id: idSchema,
  })
  .strict()
  .refine((chapter) => chapter.page_end >= chapter.page_start, {
    message: "Chapter page range must be ordered.",
    path: ["page_end"],
  });

export const courseChapterListSchema = z
  .object({
    course_slug: idSchema,
    items: z.array(courseChapterSchema),
  })
  .strict();

const courseFigureLabelSchema = z.string().regex(/^图\d{1,2}\.\d{1,3}$/u);

export const courseFigureAssetSchema = z
  .object({
    asset_id: idSchema,
    figure_label: courseFigureLabelSchema,
    caption: z.string().trim().min(1).max(300),
    textbook_title: z.string().trim().min(1).max(300),
    author_name: z.string().trim().min(1).max(100),
    edition: z.string().trim().min(1).max(100),
    publisher: z.string().trim().min(1).max(200),
    publication_year: z.number().int().min(1900).max(2100),
    isbn: z.string().regex(/^\d{3}-\d-\d{2}-\d{6}-\d$/u),
    print_page: z.number().int().positive(),
    pdf_physical_page: z.number().int().positive(),
    source_pdf_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    asset_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    storage_ref: z.string().regex(
      /^\/course-assets\/computer-organization\/[a-z0-9/_-]+\.png$/u,
    ),
    mime_type: z.literal("image/png"),
    pixel_width: z.number().int().positive().max(10_000),
    pixel_height: z.number().int().positive().max(10_000),
    verification_status: z.literal("human_verified"),
    usage_scope: z.literal("local_demo_only"),
    license_status: z.literal("unverified"),
  })
  .strict();

export const courseFigureReferenceSchema = z
  .object({
    reference_id: idSchema,
    figure_label: courseFigureLabelSchema,
    reference_text: z.string().trim().min(1).max(500),
    ordinal: z.number().int().nonnegative(),
    asset: courseFigureAssetSchema,
  })
  .strict()
  .refine((reference) => reference.figure_label === reference.asset.figure_label, {
    message: "Figure reference label must match its asset.",
    path: ["figure_label"],
  });

export const courseSourcePageSchema = z.object({
  page_id: z.string().regex(/^[a-f0-9]{12}-p[1-9]\d*$/u),
  print_page: z.number().int().positive().nullable(),
  physical_page: z.number().int().positive(),
  title: z.string().min(1).max(300),
  image_url: z.string().regex(/^\/api\/v1\/408\/courses\/[a-z-]+\/source-pages\/[a-f0-9]{12}-p[1-9]\d*\?v=[a-f0-9]{64}$/u),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();
export type CourseSourcePage = z.infer<typeof courseSourcePageSchema>;

export const courseKnowledgeChunkSchema = z
  .object({
    chunk_id: idSchema,
    source_item_id: idSchema,
    chapter: z.string().min(1).max(300),
    page: z.number().int().positive(),
    text: z.string().min(1).max(100_000),
    content_format: z.literal("plain_text"),
    source_page: courseSourcePageSchema.nullable().optional(),
    figure_references: z.array(courseFigureReferenceSchema).max(20).default([]),
    source_boundary: courseContentBoundarySchema,
  })
  .strict();

export const courseQaExampleSchema = z
  .object({
    qa_id: idSchema,
    source_item_id: idSchema,
    chapter: z.string().min(1).max(300).nullable(),
    page: z.number().int().positive().nullable(),
    question: z.string().min(1).max(30_000),
    answer: z.string().min(1).max(100_000),
    content_format: z.literal("plain_text"),
    source_boundary: courseContentBoundarySchema,
  })
  .strict();

export const courseContentPageQuerySchema = z
  .object({
    chapter: z.string().trim().min(1).max(300).optional(),
    limit: z.number().int().min(1).max(20).default(10),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();

export const courseKnowledgePageSchema = z
  .object({
    course_slug: idSchema,
    items: z.array(courseKnowledgeChunkSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const courseQaPageSchema = z
  .object({
    course_slug: idSchema,
    items: z.array(courseQaExampleSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

const courseReadingPositionFields = {
  chapter: z.string().trim().min(1).max(300),
  chunk_id: idSchema,
  paragraph_index: z.number().int().nonnegative().max(10_000),
  source_expanded: z.boolean(),
} as const;

function hasConsistentReadingExpansion(position: {
  paragraph_index: number;
  source_expanded: boolean;
}) {
  return position.paragraph_index < 2 || position.source_expanded;
}

export const courseReadingProgressUpdateSchema = z
  .object(courseReadingPositionFields)
  .strict()
  .refine(hasConsistentReadingExpansion, {
    message: "A paragraph beyond the preview requires expanded source text.",
    path: ["source_expanded"],
  });

export const courseReadingProgressSchema = z
  .object({
    course_slug: idSchema,
    ...courseReadingPositionFields,
    chunk_offset: z.number().int().nonnegative(),
    updated_at: isoDateTimeSchema,
  })
  .strict()
  .refine(hasConsistentReadingExpansion, {
    message: "A paragraph beyond the preview requires expanded source text.",
    path: ["source_expanded"],
  });

export const courseReadingProgressResponseSchema = z
  .object({
    progress: courseReadingProgressSchema.nullable(),
  })
  .strict();

export const courseConceptImportanceSchema = z.enum(["core", "extended"]);
export const courseConceptReviewStatusSchema = z.enum(["verified", "needs_review"]);

export const courseConceptSourceSchema = z
  .object({
    chunk_id: idSchema,
    print_page: z.number().int().positive(),
    chunk_offset: z.number().int().nonnegative(),
  })
  .strict();

export const courseConceptLearningNoteSchema = z
  .object({
    kind: z.enum(["misconception", "reminder"]),
    text: z.string().trim().min(1).max(500),
  })
  .strict();

export const courseConceptLearningContentSchema = z
  .object({
    explanation: z.array(z.string().trim().min(10).max(800)).min(1).max(4),
    case_prompt: z.string().trim().min(10).max(500),
    practice_tags: z.array(z.string().trim().min(1).max(80)).max(8),
  })
  .strict();

export const courseConceptFigureItemSchema = z
  .object({
    figure_label: courseFigureLabelSchema,
    caption: z.string().trim().min(1).max(300),
    storage_ref: z.string().regex(
      /^(?:\/course-assets\/computer-organization\/[a-z0-9/_-]+\.png|\/api\/v1\/408\/courses\/[a-z0-9-]+\/source-figures\/[A-Za-z0-9_-]+)$/u,
    ),
    mime_type: z.enum(["image/png", "image/webp"]),
    pixel_width: z.number().int().positive().max(10_000),
    pixel_height: z.number().int().positive().max(10_000),
  })
  .strict();

export const courseConceptFigureGuidanceSchema = z
  .object({
    primary: courseConceptFigureItemSchema.nullable(),
    related: z.array(courseConceptFigureItemSchema).max(12),
  })
  .strict();

const courseVideoExternalUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && url.hostname === "www.bilibili.com"
    && url.pathname.startsWith("/video/");
}, "Course videos must use an HTTPS Bilibili URL.");

export const courseConceptVideoItemSchema = z
  .object({
    episode_id: idSchema,
    series_title: z.string().trim().min(1).max(300),
    episode_title: z.string().trim().min(1).max(300),
    episode_number: z.number().int().positive(),
    duration: z.string().trim().min(1).max(30),
    duration_seconds: z.number().int().nonnegative(),
    uploader: z.string().trim().min(1).max(120),
    external_url: courseVideoExternalUrlSchema,
    display_role: z.enum(["primary", "related"]),
    ordinal: z.number().int().positive(),
    platform: z.literal("bilibili"),
  })
  .strict();

export const courseConceptVideoListSchema = z
  .object({
    course_slug: idSchema,
    concept_id: idSchema,
    external_only: z.literal(true),
    notice: z.string().trim().min(1).max(200),
    items: z.array(courseConceptVideoItemSchema).max(2),
  })
  .strict();

export const courseVideoKindSchema = z.enum(["teaching", "question_explanation"]);

export const courseVideoSeriesItemSchema = z
  .object({
    series_id: idSchema,
    series_title: z.string().trim().min(1).max(300),
    uploader: z.string().trim().min(1).max(120),
    video_kind: courseVideoKindSchema,
    total_duration: z.string().trim().min(1).max(30),
    total_seconds: z.number().int().nonnegative(),
    episode_count: z.number().int().positive(),
    canonical_url: courseVideoExternalUrlSchema,
    platform: z.literal("bilibili"),
  })
  .strict();

export const courseVideoSeriesPageSchema = z
  .object({
    course_slug: idSchema,
    course_title: z.string().trim().min(1).max(120),
    external_only: z.literal(true),
    notice: z.string().trim().min(1).max(300),
    query: z.string().trim().max(80),
    kind: z.enum(["all", "teaching", "question_explanation"]),
    total_series: z.number().int().nonnegative(),
    total_episodes: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().min(1).max(20),
    total_pages: z.number().int().nonnegative(),
    items: z.array(courseVideoSeriesItemSchema).max(20),
  })
  .strict();

export const courseVideoEpisodeItemSchema = z
  .object({
    episode_id: idSchema,
    episode_title: z.string().trim().min(1).max(300),
    episode_number: z.number().int().positive(),
    duration: z.string().trim().min(1).max(30),
    duration_seconds: z.number().int().nonnegative(),
    external_url: courseVideoExternalUrlSchema,
    platform: z.literal("bilibili"),
  })
  .strict();

export const courseVideoEpisodePageSchema = z
  .object({
    course_slug: idSchema,
    series: courseVideoSeriesItemSchema,
    external_only: z.literal(true),
    notice: z.string().trim().min(1).max(300),
    page: z.number().int().positive(),
    page_size: z.number().int().min(1).max(50),
    total_pages: z.number().int().nonnegative(),
    total_episodes: z.number().int().nonnegative(),
    items: z.array(courseVideoEpisodeItemSchema).max(50),
  })
  .strict();

export const courseCoreConceptSchema = z
  .object({
    concept_id: idSchema,
    title: z.string().trim().min(2).max(120),
    learning_objective: z.string().trim().min(10).max(600),
    prerequisite_concept_ids: z.array(idSchema).max(20),
    key_terms: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    learning_note: courseConceptLearningNoteSchema,
    learning_content: courseConceptLearningContentSchema.nullable().optional(),
    sources: z.array(courseConceptSourceSchema).min(1).max(8),
    importance: courseConceptImportanceSchema,
    review_status: courseConceptReviewStatusSchema,
    ordinal: z.number().int().positive(),
    practice_question_count: z.number().int().nonnegative().optional(),
    figure_guidance: courseConceptFigureGuidanceSchema.default({
      primary: null,
      related: [],
    }),
  })
  .strict();

export const courseLearningModuleSchema = z
  .object({
    module_id: idSchema,
    title: z.string().trim().min(2).max(120),
    ordinal: z.number().int().positive(),
    concepts: z.array(courseCoreConceptSchema).min(1).max(7),
  })
  .strict();

export const courseCurriculumChapterSchema = z
  .object({
    chapter_id: idSchema,
    source_chapter: z.string().trim().min(2).max(300),
    title: z.string().trim().min(2).max(120),
    ordinal: z.number().int().positive(),
    modules: z.array(courseLearningModuleSchema).min(1).max(5),
  })
  .strict();

export const courseCurriculumMapSchema = z
  .object({
    course_id: idSchema,
    course_slug: idSchema,
    title: z.literal("课程知识地图"),
    curation_method: z.literal("source_constrained_course_design"),
    chapters: z.array(courseCurriculumChapterSchema).min(1).max(20),
    concept_count: z.number().int().positive(),
    traceability: z
      .object({
        source_reference_count: z.number().int().positive(),
        valid_source_reference_count: z.number().int().nonnegative(),
        rate: z.number().min(0).max(1),
      })
      .strict(),
    generated_at: isoDateTimeSchema,
  })
  .strict()
  .superRefine((map, context) => {
    const concepts = map.chapters.flatMap((chapter) =>
      chapter.modules.flatMap((module) => module.concepts),
    );
    const sourceReferenceCount = concepts.reduce(
      (total, concept) => total + concept.sources.length,
      0,
    );
    if (map.concept_count !== concepts.length) {
      context.addIssue({
        code: "custom",
        message: "Concept count must match the derived curriculum concepts.",
        path: ["concept_count"],
      });
    }
    if (map.chapters.some((chapter) => /前言|目录|参考资料/u.test(chapter.source_chapter))) {
      context.addIssue({
        code: "custom",
        message: "Front matter cannot appear in the student curriculum map.",
        path: ["chapters"],
      });
    }
    if (map.traceability.source_reference_count !== sourceReferenceCount) {
      context.addIssue({
        code: "custom",
        message: "Source reference count must match concept sources.",
        path: ["traceability", "source_reference_count"],
      });
    }
    const expectedRate = map.traceability.source_reference_count === 0
      ? 0
      : (
          map.traceability.valid_source_reference_count
          / map.traceability.source_reference_count
        );
    if (Math.abs(map.traceability.rate - expectedRate) > 0.000_001) {
      context.addIssue({
        code: "custom",
        message: "Traceability rate must match the validated source references.",
        path: ["traceability", "rate"],
      });
    }
  });

export const aiWorkflowSlotSchema = z.enum([
  "learning_orchestration",
  "contextual_explanation",
  "guided_case",
  "practice_reflection",
  "supportive_check_in",
]);

export const aiWorkflowCapabilitySchema = z.enum([
  "plan",
  "explain",
  "coach",
  "diagnose",
  "care",
]);

export const aiWorkflowRuntimeStateSchema = z.enum([
  "not_configured",
  "configured",
  "available",
  "degraded",
  "unavailable",
]);

export const aiWorkflowRuntimeStatusSchema = z
  .object({
    state: aiWorkflowRuntimeStateSchema,
    label: z.string().trim().min(1).max(100),
    detail: z.string().trim().min(1).max(500).nullable(),
    checked_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const AI_WORKFLOW_SLOT_BY_CAPABILITY = {
  plan: "learning_orchestration",
  explain: "contextual_explanation",
  coach: "guided_case",
  diagnose: "practice_reflection",
  care: "supportive_check_in",
} as const satisfies Record<
  z.infer<typeof aiWorkflowCapabilitySchema>,
  z.infer<typeof aiWorkflowSlotSchema>
>;

export const aiWorkflowInvocationSchema = z
  .object({
    contract_version: z.literal("0.2"),
    capability: aiWorkflowCapabilitySchema,
    course_id: idSchema,
    concept_id: idSchema.nullable(),
    qa_id: idSchema.nullable(),
    attempt_id: idSchema.nullable(),
    conversation_id: idSchema.nullable().optional(),
    user_message: z.string().trim().min(1).max(4_000).nullable(),
  })
  .strict()
  .superRefine((invocation, context) => {
    const issue = (field: "concept_id" | "qa_id" | "attempt_id", message: string) => {
      context.addIssue({ code: "custom", message, path: [field] });
    };
    if (invocation.capability === "plan") {
      if (invocation.concept_id !== null) issue("concept_id", "plan requires concept_id=null.");
      if (invocation.qa_id !== null) issue("qa_id", "plan requires qa_id=null.");
      if (invocation.attempt_id !== null) issue("attempt_id", "plan requires attempt_id=null.");
    }
    if (invocation.capability === "explain") {
      if (invocation.concept_id === null) issue("concept_id", "explain requires concept_id.");
      if (invocation.qa_id !== null) issue("qa_id", "explain requires qa_id=null.");
      if (invocation.attempt_id !== null) issue("attempt_id", "explain requires attempt_id=null.");
    }
    if (invocation.capability === "coach") {
      if (invocation.concept_id === null) issue("concept_id", "coach requires concept_id.");
      if (invocation.qa_id === null) issue("qa_id", "coach requires qa_id.");
      if (invocation.attempt_id !== null) issue("attempt_id", "coach requires attempt_id=null.");
    }
    if (invocation.capability === "diagnose") {
      if (invocation.qa_id !== null) issue("qa_id", "diagnose requires qa_id=null.");
      if (invocation.attempt_id === null) issue("attempt_id", "diagnose requires attempt_id.");
    }
    if (invocation.capability === "care") {
      if (invocation.concept_id !== null) issue("concept_id", "care requires concept_id=null.");
      if (invocation.qa_id !== null) issue("qa_id", "care requires qa_id=null.");
      if (invocation.attempt_id !== null) issue("attempt_id", "care requires attempt_id=null.");
      if (invocation.conversation_id == null) {
        context.addIssue({
          code: "custom",
          message: "care requires a server-issued conversation_id.",
          path: ["conversation_id"],
        });
      }
      if (invocation.user_message === null) {
        context.addIssue({
          code: "custom",
          message: "care requires a user_message after explicit student consent.",
          path: ["user_message"],
        });
      }
    }
    if (invocation.capability !== "care" && invocation.conversation_id != null) {
      context.addIssue({
        code: "custom",
        message: "conversation_id is only valid for care.",
        path: ["conversation_id"],
      });
    }
  });

export const studentCareSignalSchema = z.enum([
  "return_after_gap",
  "accuracy_shift",
  "rhythm_drop",
]);

export const studentCareResponseActionSchema = z.enum([
  "continue",
  "lighten",
  "talk",
  "dismiss",
  "disable",
]);

const studentCareTaskTypeSchema = z.enum([
  "course_reading",
  "choice_practice",
  "mistake_review",
]);

const studentCareHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .regex(/^\/student\//u, "Care task href must stay inside the student workspace.");

export const studentCareCurrentTaskSchema = z
  .object({
    task_id: idSchema,
    task_type: studentCareTaskTypeSchema,
    course_id: idSchema,
    course_title: z.string().trim().min(1).max(300),
    concept_title: z.string().trim().min(1).max(300).nullable(),
    title: z.string().trim().min(1).max(300),
    estimated_minutes: z.number().int().min(1).max(240),
    href: studentCareHrefSchema,
  })
  .strict();

export const studentCareLightStepSchema = studentCareCurrentTaskSchema
  .omit({ concept_title: true })
  .extend({
    detail: z.string().trim().min(1).max(1_000),
    estimated_minutes: z.number().int().min(1).max(15),
  })
  .strict();

export const studentCareNoneSchema = z
  .object({
    kind: z.literal("none"),
    preference_enabled: z.boolean(),
  })
  .strict();

export const studentCareInvitationSchema = z
  .object({
    kind: z.literal("invitation"),
    preference_enabled: z.literal(true),
    interaction_id: idSchema,
    signal_code: studentCareSignalSchema,
    greeting: z.string().trim().min(1).max(500),
    reason_summary: z.string().trim().min(1).max(500),
    actions: z.tuple([
      z.literal("continue"),
      z.literal("lighten"),
      z.literal("talk"),
      z.literal("dismiss"),
      z.literal("disable"),
    ]),
    presented_at: isoDateTimeSchema,
    expires_at: isoDateTimeSchema,
  })
  .strict()
  .refine(
    (invitation) => Date.parse(invitation.expires_at) > Date.parse(invitation.presented_at),
    { message: "Care invitation must expire after it is presented.", path: ["expires_at"] },
  );

export const studentCareLightSessionSchema = z
  .object({
    kind: z.literal("light_session"),
    preference_enabled: z.literal(true),
    interaction_id: idSchema,
    signal_code: studentCareSignalSchema,
    message: z.string().trim().min(1).max(500),
    step: studentCareLightStepSchema,
    expires_at: isoDateTimeSchema,
  })
  .strict();

export const studentCareStatusSchema = z.discriminatedUnion("kind", [
  studentCareNoneSchema,
  studentCareInvitationSchema,
  studentCareLightSessionSchema,
]);

export const studentCareRespondRequestSchema = z
  .object({ action: studentCareResponseActionSchema })
  .strict();

export const studentCarePreferenceUpdateSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const studentCarePreferenceReadSchema = z
  .object({
    enabled: z.boolean(),
    updated_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const studentCarePreferenceSchema = z
  .object({
    enabled: z.boolean(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const studentCareTalkDescriptorSchema = z
  .object({
    capability: z.literal("care"),
    course_id: idSchema,
    conversation_id: idSchema,
    fallback_step: studentCareLightStepSchema,
  })
  .strict();

export const studentCareResponseResultSchema = z
  .object({
    action: studentCareResponseActionSchema,
    idempotent: z.boolean(),
    status: studentCareStatusSchema,
    talk: studentCareTalkDescriptorSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if ((result.action === "talk") !== (result.talk !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a talk response may include a talk descriptor.",
        path: ["talk"],
      });
    }
    if (result.action === "lighten" && result.status.kind !== "light_session") {
      context.addIssue({
        code: "custom",
        message: "A lighten response must return the active light session.",
        path: ["status"],
      });
    }
  });

export const aiWorkflowLearningEvidenceSchema = z
  .object({
    evidence_id: idSchema,
    kind: z.enum([
      "reading_progress",
      "answer_result",
      "hint_usage",
      "weakness_signal",
    ]),
    summary: z.string().trim().min(1).max(1_000),
    observed_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const aiWorkflowSourceChunkSchema = z
  .object({
    source_chunk_id: idSchema,
    chapter: z.string().trim().min(1).max(300),
    locator: z.string().trim().min(1).max(300).nullable(),
    content: z.string().trim().min(1).max(12_000),
  })
  .strict();

export const aiWorkflowReadingProgressContextSchema = z
  .object({
    chunk_id: idSchema,
    paragraph_index: z.number().int().min(0).max(10_000),
    source_expanded: z.boolean(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const aiWorkflowConceptContextSchema = z
  .object({
    concept_id: idSchema,
    title: z.string().trim().min(1).max(300),
    learning_objective: z.string().trim().min(1).max(1_000),
    key_terms: z.array(z.string().trim().min(1).max(120)).max(30),
  })
  .strict();

export const aiWorkflowQaCaseContextSchema = z
  .object({
    qa_id: idSchema,
    question: z.string().trim().min(1).max(8_000),
    answer: z.string().trim().min(1).max(12_000),
  })
  .strict();

export const aiWorkflowAttemptContextSchema = z
  .object({
    attempt_id: idSchema,
    question_id: idSchema,
    subject: z.string().trim().min(1).max(120),
    question_text: z.string().trim().min(1).max(12_000),
    options: z
      .array(
        z
          .object({
            option_id: z.string().trim().min(1).max(20),
            text: z.string().trim().min(1).max(4_000),
          })
          .strict(),
      )
      .min(2)
      .max(20),
    selected_option_ids: z.array(z.string().trim().min(1).max(20)).min(1).max(20),
    submitted_at: isoDateTimeSchema,
  })
  .strict();

export const aiWorkflowEvaluationContextSchema = z
  .object({
    evaluation_id: idSchema,
    grading_mode: z.literal("deterministic_choice"),
    status: z.enum(["correct", "incorrect"]),
    is_correct: z.boolean(),
    score: z.number().min(0).max(100),
    correct_option_ids: z.array(z.string().trim().min(1).max(20)).min(1).max(20),
    explanation: z.string().trim().min(1).max(12_000).nullable(),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const aiWorkflowCareTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const aiWorkflowCareCheckInContextSchema = z
  .object({
    conversation_id: idSchema,
    recent_turns: z.array(aiWorkflowCareTurnSchema).max(6),
    signal_code: studentCareSignalSchema,
    reason_summary: z.string().trim().min(1).max(500),
    consented_at: isoDateTimeSchema,
    current_task: studentCareCurrentTaskSchema,
  })
  .strict();

export const aiWorkflowContextSchema = z
  .object({
    student: z.object({ user_id: idSchema }).strict(),
    course: z
      .object({
        course_id: idSchema,
        title: z.string().trim().min(1).max(300),
        discipline: z.string().trim().min(1).max(300),
      })
      .strict(),
    concept: aiWorkflowConceptContextSchema.nullable(),
    source_chunks: z.array(aiWorkflowSourceChunkSchema).max(6),
    reading_progress: aiWorkflowReadingProgressContextSchema.nullable(),
    qa_case: aiWorkflowQaCaseContextSchema.nullable(),
    attempt: aiWorkflowAttemptContextSchema.nullable(),
    evaluation: aiWorkflowEvaluationContextSchema.nullable(),
    care_check_in: aiWorkflowCareCheckInContextSchema.nullable().optional(),
  })
  .strict();

export const aiWorkflowRequestSchema = z
  .object({
    contract_version: z.literal("0.2"),
    request_id: idSchema,
    capability: aiWorkflowCapabilitySchema,
    slot: aiWorkflowSlotSchema,
    user_id: idSchema,
    course_id: idSchema,
    concept_id: idSchema.nullable(),
    source_chunk_ids: z.array(idSchema).max(20),
    attempt_id: idSchema.nullable(),
    learning_evidence: z.array(aiWorkflowLearningEvidenceSchema).max(50),
    visual_explanations: z.boolean().optional(),
    user_message: z.string().trim().min(1).max(4_000).nullable(),
    context: aiWorkflowContextSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (AI_WORKFLOW_SLOT_BY_CAPABILITY[request.capability] !== request.slot) {
      context.addIssue({
        code: "custom",
        message: "slot must match capability.",
        path: ["capability"],
      });
    }
    if (request.context.student.user_id !== request.user_id) {
      context.addIssue({
        code: "custom",
        message: "context student must match user_id.",
        path: ["context", "student", "user_id"],
      });
    }
    if (request.context.course.course_id !== request.course_id) {
      context.addIssue({
        code: "custom",
        message: "context course must match course_id.",
        path: ["context", "course", "course_id"],
      });
    }
    if ((request.context.concept?.concept_id ?? null) !== request.concept_id) {
      context.addIssue({
        code: "custom",
        message: "context concept must match concept_id.",
        path: ["context", "concept"],
      });
    }
    if ((request.context.attempt?.attempt_id ?? null) !== request.attempt_id) {
      context.addIssue({
        code: "custom",
        message: "context attempt must match attempt_id.",
        path: ["context", "attempt"],
      });
    }
    const contextChunkIds = request.context.source_chunks.map(
      (chunk) => chunk.source_chunk_id,
    );
    if (
      contextChunkIds.length !== request.source_chunk_ids.length
      || contextChunkIds.some(
        (chunkId, index) => chunkId !== request.source_chunk_ids[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "source_chunk_ids must match context source chunks.",
        path: ["source_chunk_ids"],
      });
    }
    const careCheckIn = request.context.care_check_in ?? null;
    if (request.capability === "care" && careCheckIn === null) {
      context.addIssue({
        code: "custom",
        message: "care requires a consent-gated care_check_in context.",
        path: ["context", "care_check_in"],
      });
    }
    if (request.capability !== "care" && careCheckIn !== null) {
      context.addIssue({
        code: "custom",
        message: "care_check_in context is only valid for care.",
        path: ["context", "care_check_in"],
      });
    }
    if (careCheckIn && careCheckIn.current_task.course_id !== request.course_id) {
      context.addIssue({
        code: "custom",
        message: "care current task must match course_id.",
        path: ["context", "care_check_in", "current_task", "course_id"],
      });
    }
  });

export const aiWorkflowDisplayBlockSchema = z
  .object({
    block_id: idSchema,
    kind: z.enum(["summary", "hint", "question", "feedback", "notice"]),
    title: z.string().trim().min(1).max(160).nullable(),
    content: z.string().trim().min(1).max(8_000),
  })
  .strict();

export const aiWorkflowCitationSchema = z
  .object({
    citation_id: idSchema,
    source_chunk_id: idSchema,
    label: z.string().trim().min(1).max(300),
    locator: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

export const aiWorkflowEvidenceReferenceSchema = z
  .object({
    evidence_id: idSchema,
    label: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aiWorkflowNextActionSchema = z
  .object({
    action_id: idSchema,
    kind: z.enum([
      "open_concept",
      "start_practice",
      "continue_learning",
      "retry_workflow",
      "none",
    ]),
    label: z.string().trim().min(1).max(200),
    target: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const aiWorkflowFailureSchema = z
  .object({
    code: z.enum([
      "WORKFLOW_NOT_CONNECTED",
      "CONTEXT_INCOMPLETE",
      "UPSTREAM_UNAVAILABLE",
      "WORKFLOW_TIMEOUT",
      "WORKFLOW_FAILED",
    ]),
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    fallback_message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aiModelTraceSchema = z
  .object({
    requested_model: z.string().trim().min(1).max(200),
    provider_model: z.string().trim().min(1).max(200).nullable(),
    matched: z.boolean().nullable(),
    latency_ms: z.number().int().nonnegative(),
  })
  .strict();

export const aiWorkflowResponseSchema = z
  .object({
    contract_version: z.literal("0.2"),
    request_id: idSchema,
    capability: aiWorkflowCapabilitySchema,
    slot: aiWorkflowSlotSchema,
    status: z.enum([
      "ready",
      "degraded",
      "unavailable",
      "failed",
      "insufficient_context",
    ]),
    display_blocks: z.array(aiWorkflowDisplayBlockSchema).max(20),
    diagram: learningDiagramSchema.nullable().optional(),
    citations: z.array(aiWorkflowCitationSchema).max(30),
    evidence_refs: z.array(aiWorkflowEvidenceReferenceSchema).max(50),
    next_actions: z.array(aiWorkflowNextActionSchema).max(10),
    model_trace: aiModelTraceSchema.optional(),
    failure: aiWorkflowFailureSchema.nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    if (AI_WORKFLOW_SLOT_BY_CAPABILITY[response.capability] !== response.slot) {
      context.addIssue({
        code: "custom",
        message: "slot must match capability.",
        path: ["capability"],
      });
    }
    if (
      (
        response.status === "unavailable"
        || response.status === "failed"
        || response.status === "insufficient_context"
      )
      && response.failure === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable workflow responses require a failure.",
        path: ["failure"],
      });
    }
    if (response.status === "ready" && response.failure !== null) {
      context.addIssue({
        code: "custom",
        message: "Ready workflow responses cannot include a failure.",
        path: ["failure"],
      });
    }
    if (response.status === "ready" && response.capability === "diagnose") {
      if (!response.display_blocks.some((block) => block.kind === "feedback")) {
        context.addIssue({
          code: "custom",
          message: "Ready diagnose responses require a feedback block describing the error or result.",
          path: ["display_blocks"],
        });
      }
      if (!response.display_blocks.some((block) => block.kind === "hint")) {
        context.addIssue({
          code: "custom",
          message: "Ready diagnose responses require a hint block.",
          path: ["display_blocks"],
        });
      }
      if (response.citations.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Ready diagnose responses require at least one course citation.",
          path: ["citations"],
        });
      }
      if (response.next_actions.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Ready diagnose responses require a next action.",
          path: ["next_actions"],
        });
      }
    }
  });

/**
 * Student profile interpretation is intentionally a separate contract from
 * the four interactive AI workflow slots. The deterministic dashboard remains
 * authoritative for counts and radar dimensions; this response only adds a
 * source-constrained reading of that evidence.
 */
export const studentProfileWorkflowStatusSchema = z.enum([
  "ready",
  "unavailable",
  "failed",
  "insufficient_context",
]);

export const studentProfileCourseEvidenceLevelSchema = z.enum([
  "none",
  "limited",
  "grounded",
]);

export const studentProfileCourseProgressSchema = z
  .object({
    course_id: idSchema,
    course_title: z.string().trim().min(1).max(200),
    evidence_level: studentProfileCourseEvidenceLevelSchema,
    concept_count: z.number().int().nonnegative(),
    started_concept_count: z.number().int().nonnegative(),
    practice_attempt_count: z.number().int().nonnegative(),
    correct_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    needs_review_count: z.number().int().nonnegative(),
  })
  .strict();

export const studentProfileWorkflowRequestSchema = z
  .object({
    request_id: idSchema.optional(),
    course_id: z.enum([
      "course_408_ds",
      "course_408_co",
      "course_408_os",
      "course_408_cn",
    ]),
  })
  .strip();

const studentProfileInsightSchema = z
  .object({
    course_id: idSchema,
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().min(1).max(1_000),
    evidence_ids: z.array(idSchema).max(20),
  })
  .strict();

export const studentProfileNextTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1_000),
    course_id: idSchema,
    concept_id: idSchema.nullable(),
    estimated_minutes: z.number().int().min(5).max(360),
    evidence_ids: z.array(idSchema).max(20),
  })
  .strict();

export const studentProfileEvidenceSummarySchema = z
  .object({
    objective_evidence_count: z.number().int().nonnegative(),
    subjective_evidence_count: z.number().int().nonnegative(),
    reading_progress_count: z.number().int().nonnegative(),
    practice_attempt_count: z.number().int().nonnegative(),
    needs_review_count: z.number().int().nonnegative(),
    explanation: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const studentProfileWorkflowResponseSchema = z
  .object({
    contract_version: z.literal("0.2"),
    request_id: idSchema,
    status: studentProfileWorkflowStatusSchema,
    profile_summary: z.string().trim().min(1).max(2_000),
    course_progress: z.array(studentProfileCourseProgressSchema).max(4),
    strengths: z.array(studentProfileInsightSchema).max(10),
    priority_gaps: z.array(studentProfileInsightSchema).max(10),
    evidence_summary: studentProfileEvidenceSummarySchema,
    next_tasks: z.array(studentProfileNextTaskSchema).max(10),
    model_trace: aiModelTraceSchema.optional(),
    failure: aiWorkflowFailureSchema.nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    const failureStatuses = new Set<z.infer<typeof studentProfileWorkflowStatusSchema>>([
      "unavailable",
      "failed",
      "insufficient_context",
    ]);
    if (failureStatuses.has(response.status) && response.failure === null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Degraded profile workflow responses require a failure.",
      });
    }
    if (response.status === "ready" && response.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Ready profile workflow responses cannot include a failure.",
      });
    }
  });

export const reviewStatusSchema = z.enum([
  "unreviewed",
  "pending_review",
  "approved",
  "rejected",
]);

export const practiceMistakeStatusSchema = z.enum(["needs_review", "mastered"]);

export const practiceMistakeRecordSchema = z
  .object({
    mistake_id: idSchema,
    course_id: idSchema,
    course_title: z.string().min(1).max(200),
    question_id: idSchema,
    question_year: z.number().int().min(1900).max(2100).nullable(),
    question_number: z.number().int().positive(),
    subject: z.string().min(1).max(100),
    concept_id: idSchema.nullable(),
    concept_title: z.string().min(1).max(200).nullable(),
    matched_tag: z.string().min(1).max(100).nullable(),
    match_method: z.literal("exact_question_tag").nullable(),
    first_incorrect_attempt_id: idSchema,
    last_incorrect_attempt_id: idSchema,
    last_incorrect_evaluation_id: idSchema,
    wrong_count: z.number().int().positive(),
    status: practiceMistakeStatusSchema,
    latest_attempt_outcome: z.enum(["correct", "incorrect", "pending_review"]).nullable(),
    first_incorrect_at: isoDateTimeSchema,
    last_incorrect_at: isoDateTimeSchema,
    mastered_at: isoDateTimeSchema.nullable(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const practiceMistakeStatusUpdateSchema = z
  .object({ status: practiceMistakeStatusSchema })
  .strict();

export const mistakeRecommendationAlgorithmVersionSchema = z.literal(
  "evidence_weighted_v1",
);

export const mistakeRecommendationDueStatusSchema = z.enum(["due", "upcoming"]);

export const mistakeRecommendationEvidenceLevelSchema = z.enum([
  "limited",
  "grounded",
]);

export const mistakeRecommendationSchema = z
  .object({
    mistake_id: idSchema,
    course_id: idSchema,
    course_title: z.string().min(1).max(200),
    question_id: idSchema,
    question_number: z.number().int().positive(),
    concept_id: idSchema,
    concept_title: z.string().min(1).max(200),
    priority_score: z.number().int().min(0).max(100),
    algorithm_version: mistakeRecommendationAlgorithmVersionSchema,
    next_review_at: isoDateTimeSchema,
    due_status: mistakeRecommendationDueStatusSchema,
    evidence_level: mistakeRecommendationEvidenceLevelSchema,
    reason_lines: z.array(z.string().min(1).max(120)).min(1).max(4),
    evidence_refs: z.array(z.string().min(1).max(200)).max(10),
    practice_href: z.string().startsWith("/student/practice?").max(500),
  })
  .strict();

export const mistakeRecommendationResponseSchema = z
  .object({
    algorithm_version: mistakeRecommendationAlgorithmVersionSchema,
    generated_at: isoDateTimeSchema,
    items: z.array(mistakeRecommendationSchema).max(20),
  })
  .strict();

export type MistakeRecommendation = z.infer<typeof mistakeRecommendationSchema>;
export type MistakeRecommendationResponse = z.infer<typeof mistakeRecommendationResponseSchema>;

export const conceptEvidenceStatusSchema = z.enum([
  "signal",
  "developing",
  "provisionally_stable",
  "transfer_validated",
]);

export const learningProbeStatusSchema = z.enum([
  "offered",
  "started",
  "skipped",
  "completed",
  "expired",
]);

export const learningProbeQuestionRoleSchema = z.enum(["anchor", "contrast", "transfer"]);

export const learningProbeEvidenceSummarySchema = z
  .object({
    status: conceptEvidenceStatusSchema,
    status_label: z.string().min(1).max(100),
    statement: z.string().min(1).max(300),
    independent_correct_count: z.number().int().nonnegative(),
    distinct_correct_question_count: z.number().int().nonnegative(),
    first_correct_at: isoDateTimeSchema.nullable(),
    last_correct_at: isoDateTimeSchema.nullable(),
    unknowns: z.array(z.string().min(1).max(160)).max(4),
  })
  .strict();

export const learningProbeOfferSchema = z
  .object({
    probe_session_id: idSchema,
    course_id: idSchema,
    concept_id: idSchema,
    concept_title: z.string().min(1).max(200),
    source_attempt_id: idSchema,
    anchor_question_id: idSchema,
    question: z.lazy(() => questionPracticeItemSchema),
    hypothesis_code: z.enum([
      "rule_confusion",
      "boundary_condition",
      "concept_definition",
      "transfer",
    ]),
    surface_difference: z.string().min(8).max(500),
    status: learningProbeStatusSchema,
    fallback: z.boolean(),
    fallback_reason: z.string().min(1).max(240).nullable(),
  })
  .strict();

export const learningProbeSessionSchema = z
  .object({
    probe_session_id: idSchema,
    status: learningProbeStatusSchema,
    question_id: idSchema,
    course_id: idSchema,
    concept_id: idSchema,
    evidence: learningProbeEvidenceSummarySchema,
    next_review_at: isoDateTimeSchema.nullable(),
    completed_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const learningProbeDecisionRequestSchema = z
  .object({
    decision: z.enum(["start", "skip"]),
  })
  .strict();

export const learningProbeResultSchema = z
  .object({
    session: learningProbeSessionSchema,
    evaluation: z.lazy(() => questionEvaluationResultSchema),
    evidence_kind: z.enum(["item_review", "concept_evidence"]),
    evidence_statement: z.string().min(1).max(300),
    next_task: z
      .object({
        label: z.string().min(1).max(200),
        href: z.string().startsWith("/student/").max(500),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const learningProbeEventRequestSchema = z
  .object({
    question_id: idSchema,
    answer_type: z.literal("choice"),
    selected_option_ids: z.array(idSchema).min(1).max(26),
  })
  .strict();

export type ConceptEvidenceStatus = z.infer<typeof conceptEvidenceStatusSchema>;
export type LearningProbeStatus = z.infer<typeof learningProbeStatusSchema>;
export type LearningProbeQuestionRole = z.infer<typeof learningProbeQuestionRoleSchema>;
export type LearningProbeEvidenceSummary = z.infer<typeof learningProbeEvidenceSummarySchema>;
export type LearningProbeOffer = z.infer<typeof learningProbeOfferSchema>;
export type LearningProbeSession = z.infer<typeof learningProbeSessionSchema>;
export type LearningProbeDecisionRequest = z.infer<typeof learningProbeDecisionRequestSchema>;
export type LearningProbeResult = z.infer<typeof learningProbeResultSchema>;
export type LearningProbeEventRequest = z.infer<typeof learningProbeEventRequestSchema>;

export const learningConceptProgressSchema = z
  .object({
    concept_id: idSchema,
    title: z.string().min(1).max(200),
    status: z.enum(["not_started", "reading", "practiced", "needs_review", "mastered"]),
    attempt_count: z.number().int().nonnegative(),
    correct_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    mistake_count: z.number().int().nonnegative(),
    practice_question_count: z.number().int().nonnegative().optional(),
  })
  .strict();

export const learningCourseRecordSchema = z
  .object({
    course_id: idSchema,
    title: z.string().min(1).max(200),
    concept_count: z.number().int().nonnegative(),
    started_concept_count: z.number().int().nonnegative(),
    practice_attempt_count: z.number().int().nonnegative(),
    correct_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    needs_review_count: z.number().int().nonnegative(),
    mastered_count: z.number().int().nonnegative(),
    concepts: z.array(learningConceptProgressSchema).max(500),
  })
  .strict();

export const learningRecordSchema = z
  .object({
    courses: z.array(learningCourseRecordSchema).max(20),
    generated_at: isoDateTimeSchema,
  })
  .strict();

export const PERSONAL_LEARNING_DIMENSION_KEYS = [
  "knowledge_coverage",
  "practice_coverage",
  "answer_accuracy",
  "mistake_recovery",
  "mastery_stability",
] as const;

export const personalLearningDimensionKeySchema = z.enum(
  PERSONAL_LEARNING_DIMENSION_KEYS,
);

export const personalLearningEvidenceLevelSchema = z.enum([
  "none",
  "limited",
  "grounded",
]);

export const personalLearningDimensionSchema = z
  .object({
    key: personalLearningDimensionKeySchema,
    label: z.string().min(1).max(100),
    score: z.number().int().min(0).max(100).nullable(),
    evidence_count: z.number().int().nonnegative(),
    evidence_level: personalLearningEvidenceLevelSchema,
    explanation: z.string().min(1).max(500),
    recommendation: z.string().min(1).max(500),
  })
  .strict();

export const personalLearningNextActionSchema = z
  .object({
    kind: z.enum([
      "start_course",
      "continue_course",
      "practice_concept",
      "review_mistakes",
    ]),
    label: z.string().min(1).max(200),
    concept_id: idSchema.nullable(),
  })
  .strict();

export const personalLearningCourseSchema = z
  .object({
    course_id: idSchema,
    title: z.string().min(1).max(200),
    concept_count: z.number().int().nonnegative(),
    started_concept_count: z.number().int().nonnegative(),
    practice_attempt_count: z.number().int().nonnegative(),
    correct_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    needs_review_count: z.number().int().nonnegative(),
    mastered_count: z.number().int().nonnegative(),
    evidence_level: personalLearningEvidenceLevelSchema,
    dimensions: z.array(personalLearningDimensionSchema).length(5),
    strongest_dimension_key: personalLearningDimensionKeySchema.nullable(),
    priority_dimension_key: personalLearningDimensionKeySchema.nullable(),
    priority_concept: learningConceptProgressSchema.nullable(),
    recent_mistakes: z.array(practiceMistakeRecordSchema).max(3),
    next_action: personalLearningNextActionSchema,
  })
  .strict()
  .superRefine((course, context) => {
    const keys = course.dimensions.map((dimension) => dimension.key);
    if (keys.some((key, index) => key !== PERSONAL_LEARNING_DIMENSION_KEYS[index])) {
      context.addIssue({
        code: "custom",
        message: "Personal learning dimensions must use the fixed comparable order.",
        path: ["dimensions"],
      });
    }
  });

export const personalLearningDashboardSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    totals: z
      .object({
        course_count: z.number().int().nonnegative(),
        concept_count: z.number().int().nonnegative(),
        started_concept_count: z.number().int().nonnegative(),
        practice_attempt_count: z.number().int().nonnegative(),
        correct_count: z.number().int().nonnegative(),
        incorrect_count: z.number().int().nonnegative(),
        needs_review_count: z.number().int().nonnegative(),
      })
      .strict(),
    courses: z.array(personalLearningCourseSchema).max(20),
  })
  .strict();

export const ONBOARDING_COURSE_IDS = [
  "course_408_ds",
  "course_408_co",
  "course_408_os",
  "course_408_cn",
] as const;

export const onboardingCourseIdSchema = z.enum(ONBOARDING_COURSE_IDS);
export const onboardingStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
export const onboardingStepSchema = z.enum([
  "goals",
  "self_assessment",
  "diagnostic",
  "profile",
  "plan",
]);
export const onboardingPreparationStageSchema = z.enum([
  "preparing",
  "foundation",
  "strengthening",
  "sprint",
]);
export const onboardingSelfAssessmentLevelSchema = z.enum([
  "not_started",
  "weak",
  "average",
  "good",
  "reinforcing",
]);

export const onboardingGoalInputSchema = z
  .object({
    target_exam_year: z.number().int().min(2026).max(2100),
    preparation_stage: onboardingPreparationStageSchema,
    daily_minutes: z.number().int().min(30).max(360).multipleOf(15),
    target_school: z.string().trim().min(1).max(120).nullable().optional(),
    target_score: z.number().int().min(0).max(150).nullable().optional(),
  })
  .strict();

export const onboardingGoalsSchema = onboardingGoalInputSchema.extend({
  saved_at: isoDateTimeSchema,
}).strict();

const admissionsSubjectScoresSchema = z
  .object({
    politics: z.number().int().min(0).max(150).nullable(),
    foreign_language: z.number().int().min(0).max(150).nullable(),
    business_course_1: z.number().int().min(0).max(150).nullable(),
    business_course_2: z.number().int().min(0).max(150).nullable(),
  })
  .strict();

const admissionsRetestLineSchema = z
  .object({
    line_id: idSchema,
    year: z.number().int().min(1900).max(2100),
    retest_score: z.number().int().min(0).max(500),
    subject_scores: admissionsSubjectScoresSchema,
    direction: z.string().max(300).nullable(),
    source_url: z.string().url(),
    source_kind: z.enum(["official", "third_party_public"]),
  })
  .strict();

const admissionsTargetSummarySchema = z
  .object({
    target_id: idSchema,
    school: z.string().min(1).max(200),
    training_unit: z.string().min(1).max(200),
    program_code: z.string().min(1).max(50),
    program_name: z.string().min(1).max(200),
    study_mode: z.string().min(1).max(50),
    available_years: z.array(z.number().int().min(1900).max(2100)).max(20),
    retest_lines: z.array(admissionsRetestLineSchema).max(20),
  })
  .strict();

export const admissionsTargetSearchQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    page_size: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const admissionsTargetSearchResponseSchema = z
  .object({
    items: z.array(admissionsTargetSummarySchema).max(50),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().positive().max(50),
    available_years: z.array(z.number().int().min(1900).max(2100)).max(20),
    data_boundary: z
      .object({
        scope: z.literal("retest_cutoff_information_only"),
        notice: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export const admissionsTargetSelectionSchema = z
  .object({ target_id: idSchema })
  .strict();

export const admissionsCurrentTargetSchema = z
  .object({
    target: admissionsTargetSummarySchema.nullable(),
    saved_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const onboardingSelfAssessmentSchema = z
  .object({
    course_id: onboardingCourseIdSchema,
    level: onboardingSelfAssessmentLevelSchema,
  })
  .strict();

export const onboardingSelfAssessmentsUpdateSchema = z
  .object({ items: z.array(onboardingSelfAssessmentSchema).length(4) })
  .strict()
  .superRefine((value, context) => {
    const actual = new Set(value.items.map((item) => item.course_id));
    if (actual.size !== ONBOARDING_COURSE_IDS.length
      || ONBOARDING_COURSE_IDS.some((courseId) => !actual.has(courseId))) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Self assessments must contain each 408 course exactly once.",
      });
    }
  });

export const onboardingDiagnosticResponseStatusSchema = z.enum([
  "answered",
  "unsure",
  "skipped",
]);

export const onboardingDiagnosticAnswerSchema = z
  .object({
    question_id: idSchema,
    response_status: onboardingDiagnosticResponseStatusSchema,
    selected_option_ids: z.array(idSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.response_status === "answered" && value.selected_option_ids.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["selected_option_ids"],
        message: "An answered diagnostic question requires at least one option.",
      });
    }
    if (value.response_status !== "answered" && value.selected_option_ids.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selected_option_ids"],
        message: "Skipped or unsure responses cannot contain selected options.",
      });
    }
    if (new Set(value.selected_option_ids).size !== value.selected_option_ids.length) {
      context.addIssue({
        code: "custom",
        path: ["selected_option_ids"],
        message: "Selected diagnostic options must be unique.",
      });
    }
  });

export const onboardingDiagnosticQuestionSchema = z
  .object({
    ordinal: z.number().int().min(1).max(8),
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    response_status: onboardingDiagnosticResponseStatusSchema.nullable().default(null),
    selected_option_ids: z.array(idSchema).max(20).default([]),
    question: z.lazy(() => questionDtoSchema),
  })
  .strict();

export const onboardingDiagnosticQuestionSetSchema = z
  .object({
    set_version: z.string().min(1).max(50),
    items: z.array(onboardingDiagnosticQuestionSchema).length(8),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.items.map((item) => item.question.id));
    if (ids.size !== 8) {
      context.addIssue({ code: "custom", path: ["items"], message: "Diagnostic question ids must be unique." });
    }
    for (const courseId of ONBOARDING_COURSE_IDS) {
      if (value.items.filter((item) => item.course_id === courseId).length !== 2) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Each 408 course must contribute exactly two diagnostic questions.",
        });
      }
    }
  });

export const onboardingRiskConceptSchema = z
  .object({
    concept_id: idSchema,
    concept_title: z.string().min(1).max(200),
    course_id: onboardingCourseIdSchema,
    evidence_refs: z.array(z.string().min(1).max(200)).min(1).max(20),
    note: z.string().min(1).max(500),
  })
  .strict();

export const onboardingScreeningSummarySchema = z
  .object({
    status: z.literal("completed"),
    answered_count: z.number().int().min(0).max(8),
    correct_count: z.number().int().min(0).max(8),
    incorrect_count: z.number().int().min(0).max(8),
    unsure_count: z.number().int().min(0).max(8),
    skipped_count: z.number().int().min(0).max(8),
    risk_concepts: z.array(onboardingRiskConceptSchema).max(8),
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      summary.answered_count + summary.unsure_count + summary.skipped_count !== 8
      || summary.correct_count + summary.incorrect_count !== summary.answered_count
    ) {
      context.addIssue({
        code: "custom",
        path: ["answered_count"],
        message: "Screening counts must account for all eight questions.",
      });
    }
  });

export const onboardingCoursePrioritySchema = z
  .object({
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    priority: z.enum(["focus", "strengthen", "maintain"]),
    self_assessment: onboardingSelfAssessmentLevelSchema,
    evidence_level: z.enum(["self_report_only", "screening_signal"]),
    evidence_refs: z.array(z.string().min(1).max(200)).min(1).max(20),
    rationale: z.string().min(1).max(500),
    screening_signal: z.enum(["none", "observed_gap", "needs_evidence"]).optional(),
  })
  .strict();

export const onboardingInitialProfileSchema = z
  .object({
    profile_id: idSchema,
    version: z.number().int().positive(),
    confidence: z.literal("low"),
    evidence_status: z.literal("accumulating"),
    confidence_explanation: z.string().min(1).max(500),
    generated_at: isoDateTimeSchema,
    objective_evidence_count: z.literal(0),
    subjective_evidence_count: z.number().int().min(0).max(4),
    priority_courses: z.array(onboardingCoursePrioritySchema).length(4),
    boundary_note: z.string().min(1).max(500),
    screening: onboardingScreeningSummarySchema.optional(),
  })
  .strict()
  .superRefine((profile, context) => {
    const courseIds = new Set(profile.priority_courses.map((course) => course.course_id));
    if (courseIds.size !== 4 || ONBOARDING_COURSE_IDS.some((courseId) => !courseIds.has(courseId))) {
      context.addIssue({
        code: "custom",
        path: ["priority_courses"],
        message: "Initial profile must include all four 408 courses.",
      });
    }
  });

export const studentLearningTaskTypeSchema = z.enum([
  "course_reading",
  "choice_practice",
  "mistake_review",
]);

export const onboardingLearningTaskSchema = z
  .object({
    task_id: idSchema,
    day_index: z.number().int().min(1).max(7),
    task_date: z.string().date(),
    order: z.number().int().positive().max(10),
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    concept_id: idSchema.nullable(),
    concept_title: z.string().min(1).max(200).nullable(),
    task_type: studentLearningTaskTypeSchema,
    estimated_minutes: z.number().int().min(5).max(360),
    title: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    completion_criteria: z.string().min(1).max(500),
    href: z.string().startsWith("/student/").max(500),
    evidence_refs: z.array(z.string().min(1).max(200)).min(1).max(20),
    status: z.enum(["pending", "completed"]),
  })
  .strict();

export const onboardingLearningPlanSchema = z
  .object({
    plan_id: idSchema,
    version: z.number().int().positive(),
    source: z.literal("deterministic_fallback"),
    ai_status: z.literal("unavailable"),
    ai_status_message: z.string().min(1).max(500),
    start_date: z.string().date(),
    daily_minutes: z.number().int().min(30).max(360),
    generated_at: isoDateTimeSchema,
    tasks: z.array(onboardingLearningTaskSchema).min(7).max(70),
    today_task_id: idSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    const dayIndexes = new Set(plan.tasks.map((task) => task.day_index));
    if (dayIndexes.size !== 7 || Array.from({ length: 7 }, (_, index) => index + 1).some((day) => !dayIndexes.has(day))) {
      context.addIssue({ code: "custom", path: ["tasks"], message: "Learning plan must cover each of seven days." });
    }
    for (let day = 1; day <= 7; day += 1) {
      const minutes = plan.tasks
        .filter((task) => task.day_index === day)
        .reduce((sum, task) => sum + task.estimated_minutes, 0);
      if (minutes > plan.daily_minutes) {
        context.addIssue({
          code: "custom",
          path: ["tasks"],
          message: `Day ${day} exceeds the learner daily time budget.`,
        });
      }
    }
    if (!plan.tasks.some((task) => task.task_id === plan.today_task_id && task.day_index === 1)) {
      context.addIssue({
        code: "custom",
        path: ["today_task_id"],
        message: "Today task must reference a day-one task.",
      });
    }
  });

export const onboardingDiagnosticSummarySchema = z
  .object({
    total_count: z.literal(8),
    saved_count: z.number().int().min(0).max(8),
    completed_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const onboardingDiagnosticQuestionSetResponseSchema = z
  .object({
    set_version: z.string().min(1).max(50),
    summary: onboardingDiagnosticSummarySchema,
    items: z.array(onboardingDiagnosticQuestionSchema).length(8),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.items.map((item) => item.question.id));
    if (ids.size !== 8) {
      context.addIssue({ code: "custom", path: ["items"], message: "Diagnostic question ids must be unique." });
    }
    for (const courseId of ONBOARDING_COURSE_IDS) {
      if (value.items.filter((item) => item.course_id === courseId).length !== 2) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Each 408 course must contribute exactly two diagnostic questions.",
        });
      }
    }
  });

export const onboardingStateSchema = z
  .object({
    status: onboardingStatusSchema,
    current_step: onboardingStepSchema,
    goals: onboardingGoalsSchema.nullable(),
    self_assessments: z.array(onboardingSelfAssessmentSchema).max(4),
    profile: onboardingInitialProfileSchema.nullable(),
    plan: onboardingLearningPlanSchema.nullable(),
    diagnostic: onboardingDiagnosticSummarySchema.nullable().optional(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const studentLearningEvidenceSummarySchema = z
  .object({
    basis: z.enum(["initial_plan", "live_evidence", "course_structure"]),
    confidence: z.enum(["low", "developing", "grounded"]),
    objective_evidence_count: z.number().int().nonnegative(),
    subjective_evidence_count: z.number().int().min(0).max(4),
    reading_progress_count: z.number().int().min(0).max(4),
    practice_attempt_count: z.number().int().nonnegative(),
    needs_review_count: z.number().int().nonnegative(),
    explanation: z.string().min(1).max(500),
    evidence_refs: z.array(z.string().min(1).max(200)).max(30),
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.basis === "initial_plan" && summary.objective_evidence_count !== 0) {
      context.addIssue({
        code: "custom",
        path: ["objective_evidence_count"],
        message: "Initial-plan evidence cannot include objective learning records.",
      });
    }
    if (summary.objective_evidence_count === 0 && summary.confidence !== "low") {
      context.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "A snapshot without objective evidence must remain low confidence.",
      });
    }
  });

export const studentLearningOrchestrationTaskSchema = z
  .object({
    task_id: idSchema,
    source: z.enum(["mistake", "reading_progress", "initial_plan", "course_fallback", "probe"]),
    task_type: studentLearningTaskTypeSchema,
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    concept_id: idSchema.nullable(),
    concept_title: z.string().min(1).max(200).nullable(),
    mistake_id: idSchema.nullable(),
    probe_session_id: idSchema.nullable(),
    title: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    completion_criteria: z.string().min(1).max(500),
    estimated_minutes: z.number().int().min(5).max(360),
    href: z.string().startsWith("/student/").max(500),
    practice_question_count: z.number().int().nonnegative(),
    evidence_refs: z.array(z.string().min(1).max(200)).min(1).max(30),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.source === "mistake" && (task.task_type !== "mistake_review" || !task.mistake_id)) {
      context.addIssue({
        code: "custom",
        path: ["mistake_id"],
        message: "Mistake-sourced tasks must reference a mistake review record.",
      });
    }
    if (task.source !== "mistake" && task.mistake_id !== null) {
      context.addIssue({
        code: "custom",
        path: ["mistake_id"],
        message: "Only mistake-sourced tasks can expose a mistake id.",
      });
    }
    if (task.source === "probe" && !task.probe_session_id) {
      context.addIssue({
        code: "custom",
        path: ["probe_session_id"],
        message: "Probe-sourced tasks must reference a learning probe session.",
      });
    }
    if (task.source !== "probe" && task.probe_session_id !== null) {
      context.addIssue({
        code: "custom",
        path: ["probe_session_id"],
        message: "Only probe-sourced tasks can expose a probe session id.",
      });
    }
    if (
      task.task_type === "choice_practice"
      && task.practice_question_count === 0
      && /(?:\?|&)concept_id=/u.test(task.href)
    ) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: "Concept practice links require at least one reliable linked question.",
      });
    }
  });

export const studentLearningTaskCompletionRequestSchema = z
  .object({
    task_id: idSchema,
  })
  .strict();

export const studentLearningTaskActivationSchema = z
  .object({
    task_id: idSchema,
    activated_at: isoDateTimeSchema,
    idempotent: z.boolean(),
  })
  .strict();

export const studentLearningTaskSettlementSchema = z
  .object({
    version: z.literal("challenge_settlement_v1"),
    task_type: studentLearningTaskTypeSchema,
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    concept_id: idSchema.nullable(),
    concept_title: z.string().min(1).max(200).nullable(),
    outcome: z.enum(["correct", "incorrect", "completed"]),
    result_title: z.string().min(1).max(200),
    result_detail: z.string().min(1).max(500),
    evidence_update: z.object({
      added_count: z.number().int().positive().max(20),
      objective_total: z.number().int().nonnegative(),
      summary: z.string().min(1).max(500),
    }).strict(),
    profile_update: z.object({
      kind: z.enum([
        "practice_correct",
        "practice_review",
        "review_progress",
        "mastered",
        "learning_progress",
      ]),
      title: z.string().min(1).max(200),
      detail: z.string().min(1).max(500),
    }).strict(),
    review_update: z.object({
      status: z.enum(["not_required", "needs_review", "in_progress", "mastered", "not_applicable"]),
      mistake_id: idSchema.nullable(),
      next_review_at: isoDateTimeSchema.nullable(),
      summary: z.string().min(1).max(500),
    }).strict(),
    plan_progress: z.object({
      tracked: z.boolean(),
      completed_task_count: z.number().int().nonnegative(),
      total_task_count: z.number().int().nonnegative(),
      completion_percent: z.number().int().min(0).max(100),
    }).strict(),
    next_task: z.object({
      task_id: idSchema,
      task_type: studentLearningTaskTypeSchema,
      course_id: onboardingCourseIdSchema,
      course_title: z.string().min(1).max(200),
      concept_id: idSchema.nullable(),
      concept_title: z.string().min(1).max(200).nullable(),
      title: z.string().min(1).max(200),
      reason: z.string().min(1).max(500),
      estimated_minutes: z.number().int().min(5).max(360),
      href: z.string().startsWith("/student/").max(500),
    }).strict().nullable(),
  })
  .strict()
  .superRefine((settlement, context) => {
    if (settlement.task_type === "choice_practice" && settlement.outcome === "completed") {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Choice-practice settlements require a deterministic correct or incorrect outcome.",
      });
    }
    if (settlement.task_type !== "choice_practice" && settlement.outcome !== "completed") {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Only choice-practice settlements can report correct or incorrect outcomes.",
      });
    }
    if (settlement.outcome === "incorrect" && settlement.review_update.status !== "needs_review") {
      context.addIssue({
        code: "custom",
        path: ["review_update", "status"],
        message: "Incorrect deterministic choices must enter the review queue.",
      });
    }
    const reviewNeedsMistake = new Set(["needs_review", "in_progress", "mastered"]);
    if (reviewNeedsMistake.has(settlement.review_update.status) && !settlement.review_update.mistake_id) {
      context.addIssue({
        code: "custom",
        path: ["review_update", "mistake_id"],
        message: "Review-state changes must reference the student's mistake record.",
      });
    }
    if (
      !reviewNeedsMistake.has(settlement.review_update.status)
      && (settlement.review_update.mistake_id !== null || settlement.review_update.next_review_at !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["review_update"],
        message: "Non-review settlements cannot expose mistake scheduling fields.",
      });
    }
    if (settlement.review_update.status === "mastered" && settlement.review_update.next_review_at !== null) {
      context.addIssue({
        code: "custom",
        path: ["review_update", "next_review_at"],
        message: "Mastered mistakes cannot retain a next review date.",
      });
    }
    const expectedPercent = settlement.plan_progress.total_task_count === 0
      ? 0
      : Math.round(
        (settlement.plan_progress.completed_task_count / settlement.plan_progress.total_task_count) * 100,
      );
    if (
      settlement.plan_progress.completed_task_count > settlement.plan_progress.total_task_count
      || settlement.plan_progress.completion_percent !== expectedPercent
    ) {
      context.addIssue({
        code: "custom",
        path: ["plan_progress"],
        message: "Settlement plan progress must be internally consistent.",
      });
    }
  });

export const studentLearningTaskCompletionSchema = z
  .object({
    task_id: idSchema,
    completed_at: isoDateTimeSchema,
    evidence_refs: z.array(z.string().min(1).max(200)).min(1).max(20),
    idempotent: z.boolean(),
    next_task_id: idSchema.nullable(),
    settlement: studentLearningTaskSettlementSchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (completion.next_task_id !== (completion.settlement.next_task?.task_id ?? null)) {
      context.addIssue({
        code: "custom",
        path: ["next_task_id"],
        message: "Completion next_task_id must match the persisted settlement next task.",
      });
    }
  });

export const studentLearningPlanTaskProgressSchema = z
  .object({
    task_id: idSchema,
    day_index: z.number().int().min(1).max(7),
    task_date: z.string().date(),
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    concept_id: idSchema.nullable(),
    concept_title: z.string().min(1).max(200).nullable(),
    task_type: studentLearningTaskTypeSchema,
    title: z.string().min(1).max(200),
    estimated_minutes: z.number().int().min(5).max(360),
    href: z.string().startsWith("/student/").max(500),
    status: z.enum(["pending", "completed"]),
    completion_evidence_refs: z.array(z.string().min(1).max(200)).max(20),
  })
  .strict();

export const studentLearningPlanProgressSchema = z
  .object({
    plan_id: idSchema.nullable(),
    completed_task_count: z.number().int().nonnegative(),
    total_task_count: z.number().int().nonnegative(),
    completion_percent: z.number().int().min(0).max(100),
    tasks: z.array(studentLearningPlanTaskProgressSchema).max(70),
  })
  .strict()
  .superRefine((progress, context) => {
    const completed = progress.tasks.filter((task) => task.status === "completed").length;
    const expectedPercent = progress.total_task_count === 0
      ? 0
      : Math.round((progress.completed_task_count / progress.total_task_count) * 100);
    if (
      progress.total_task_count !== progress.tasks.length
      || progress.completed_task_count !== completed
      || progress.completion_percent !== expectedPercent
    ) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "Learning-plan progress counts must match the task list.",
      });
    }
  });

export const studentLearningCoursePrioritySchema = z
  .object({
    rank: z.number().int().min(1).max(4),
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    priority: z.enum(["focus", "strengthen", "maintain"]),
    evidence_level: z.enum(["self_report_only", "limited", "grounded"]),
    rationale: z.string().min(1).max(500),
    started_concept_count: z.number().int().nonnegative(),
    concept_count: z.number().int().nonnegative(),
    practice_attempt_count: z.number().int().nonnegative(),
    needs_review_count: z.number().int().nonnegative(),
    href: z.string().startsWith("/student/courses/").max(500),
  })
  .strict();

export const studentLearningChallengeNodeSchema = z
  .object({
    node_id: idSchema,
    task_id: idSchema.nullable(),
    kind: z.enum(["course_reading", "choice_practice", "mistake_review", "chapter_checkpoint"]),
    status: z.enum([
      "completed",
      "recommended",
      "available",
      "in_progress",
      "review_due",
      "insufficient_evidence",
    ]),
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    concept_id: idSchema.nullable(),
    title: z.string().min(1).max(200),
    href: z.string().startsWith("/student/").max(500),
  })
  .strict();

export const studentLearningChallengeActivitySchema = z
  .object({
    completed_day_count: z.number().int().min(0).max(7),
    days: z.array(z.object({
      date: z.string().date(),
      completed: z.boolean(),
    }).strict()).length(7),
  })
  .strict()
  .superRefine((activity, context) => {
    const completedDays = activity.days.filter((day) => day.completed).length;
    const uniqueDates = new Set(activity.days.map((day) => day.date));
    if (completedDays !== activity.completed_day_count) {
      context.addIssue({
        code: "custom",
        path: ["completed_day_count"],
        message: "Completed-day count must match the seven-day activity list.",
      });
    }
    if (uniqueDates.size !== activity.days.length) {
      context.addIssue({
        code: "custom",
        path: ["days"],
        message: "Challenge activity dates must be unique.",
      });
    }
  });

export const studentLearningProfileUpdateSchema = z
  .object({
    update_id: idSchema,
    course_id: onboardingCourseIdSchema,
    course_title: z.string().min(1).max(200),
    kind: z.enum(["reading", "practice", "mistake", "task_completion", "starting_point"]),
    occurred_at: isoDateTimeSchema.nullable(),
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(500),
  })
  .strict();

export const studentLearningChallengeJourneySchema = z
  .object({
    current_stage_label: z.string().min(1).max(200),
    current_node_id: idSchema,
    nodes: z.array(studentLearningChallengeNodeSchema).min(1).max(5),
    recent_activity: studentLearningChallengeActivitySchema,
    profile_updates: z.array(studentLearningProfileUpdateSchema).min(1).max(3),
  })
  .strict()
  .superRefine((journey, context) => {
    const nodeIds = new Set(journey.nodes.map((node) => node.node_id));
    if (nodeIds.size !== journey.nodes.length) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Challenge journey node ids must be unique.",
      });
    }
    const currentNodes = journey.nodes.filter((node) => node.node_id === journey.current_node_id);
    if (currentNodes.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["current_node_id"],
        message: "Challenge journey must identify exactly one current node.",
      });
    }
  });

export const studentLearningOrchestrationSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    source: z.literal("deterministic_evidence_rules"),
    ai_status: z.literal("unavailable"),
    ai_status_message: z.string().min(1).max(500),
    goal_context: onboardingGoalsSchema.omit({ saved_at: true }).nullable(),
    evidence_summary: studentLearningEvidenceSummarySchema,
    plan_progress: studentLearningPlanProgressSchema,
    challenge_journey: studentLearningChallengeJourneySchema,
    current_task: studentLearningOrchestrationTaskSchema,
    course_priorities: z.array(studentLearningCoursePrioritySchema).length(4),
    boundary_note: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const currentJourneyNode = snapshot.challenge_journey.nodes.find((node) => (
      node.node_id === snapshot.challenge_journey.current_node_id
    ));
    if (currentJourneyNode?.task_id !== snapshot.current_task.task_id) {
      context.addIssue({
        code: "custom",
        path: ["challenge_journey", "current_node_id"],
        message: "The current challenge node must represent the current orchestration task.",
      });
    }
    const courseIds = new Set(snapshot.course_priorities.map((course) => course.course_id));
    const ranks = new Set(snapshot.course_priorities.map((course) => course.rank));
    if (
      courseIds.size !== ONBOARDING_COURSE_IDS.length
      || ONBOARDING_COURSE_IDS.some((courseId) => !courseIds.has(courseId))
      || ranks.size !== 4
      || [1, 2, 3, 4].some((rank) => !ranks.has(rank))
    ) {
      context.addIssue({
        code: "custom",
        path: ["course_priorities"],
        message: "The orchestration snapshot must rank every 408 course exactly once.",
      });
    }
  });

export const licenseStatusSchema = z.enum(["unverified", "verified", "restricted"]);

export const materialRecordSchema = z
  .object({
    material_id: idSchema,
    course_id: idSchema,
    title: z.string().min(1).max(300),
    material_type: z.enum([
      "course_handout",
      "textbook",
      "exercise_set",
      "reference",
      "other",
    ]),
    source_url: z.string().url().nullable(),
    storage_ref: z.string().min(1).max(1_000).nullable(),
    review_status: reviewStatusSchema,
    license_status: licenseStatusSchema,
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const questionTypeSchema = z.enum(["choice", "subjective"]);

export const practiceModeSchema = z.enum([
  "diagnostic",
  "targeted",
  "past_exam",
  "mock_exam",
  "mistake_review",
]);

export const questionSourceTypeSchema = z.enum([
  "past_exam",
  "mock_exam",
  "self_authored_screening",
  "self_authored_practice",
]);

export const questionLearningMetadataSchema = z
  .object({
    source_type: questionSourceTypeSchema,
    allowed_modes: z.array(practiceModeSchema).min(1).max(5),
    paper_year: z.number().int().min(1900).max(2100).nullable(),
    protect_full_paper: z.boolean(),
    importance: z.enum(["core", "extended"]),
    content_review_status: z.enum([
      "pending_teacher_review",
      "demo_validated",
      "teacher_verified",
    ]),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (new Set(metadata.allowed_modes).size !== metadata.allowed_modes.length) {
      context.addIssue({
        code: "custom",
        path: ["allowed_modes"],
        message: "Question learning modes must be unique.",
      });
    }
    if (metadata.protect_full_paper && metadata.paper_year === null) {
      context.addIssue({
        code: "custom",
        path: ["paper_year"],
        message: "A protected full-paper question requires a paper year.",
      });
    }
    if (
      metadata.source_type === "self_authored_screening"
      && (
        metadata.paper_year !== null
        || metadata.protect_full_paper
        || metadata.allowed_modes.length !== 1
        || metadata.allowed_modes[0] !== "diagnostic"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowed_modes"],
        message: "Self-authored screening questions are diagnostic-only and have no paper year.",
      });
    }
  });

export const questionRankingExplanationSchema = z
  .object({
    algorithm_version: z.literal("fsrs_v6_weighted_v1"),
    priority_score: z.number().int().min(0).max(100),
    evidence_level: z.enum(["limited", "grounded"]),
    components: z
      .object({
        memory_risk: z.number().min(0).max(1),
        concept_weakness: z.number().min(0).max(1),
        repeated_error: z.number().min(0).max(1),
        importance: z.number().min(0).max(1),
        novelty: z.number().min(0).max(1),
      })
      .strict(),
    reason_lines: z.array(z.string().trim().min(1).max(120)).max(4),
  })
  .strict();

export const questionSourceSchema = z
  .object({
    provider: z.string().min(1).max(200),
    dataset_id: z.string().min(1).max(200),
    source_url: z.string().url(),
    license_status: licenseStatusSchema,
    usage_scope: z.enum(["local_demo_only", "authorized_product_use"]),
  })
  .strict();

export const questionAssetReferenceSchema = z
  .object({
    asset_id: idSchema,
    role: z.enum(["question", "option", "explanation", "solution"]),
    option_id: idSchema.nullable(),
    reference_kind: z.enum(["embedded_source", "local_file", "external_url"]),
    source_reference: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => !value.startsWith("data:"), {
        message: "Question asset references must not expose embedded payloads.",
      }),
    mime_type: z.string().min(1).max(100).nullable(),
    availability: z.enum([
      "metadata_only",
      "local_file",
      "external_reference",
      "authenticated_api",
    ]),
  })
  .strict();

export const questionOptionSchema = z
  .object({
    option_id: idSchema,
    text: z.string().min(1).max(10_000),
    assets: z.array(questionAssetReferenceSchema).max(20),
  })
  .strict();

export const questionDtoSchema = z
  .object({
    id: idSchema,
    year: z.number().int().min(1900).max(2100).nullable(),
    number: z.number().int().positive(),
    subject: z.string().min(1).max(100),
    type: questionTypeSchema,
    multiple: z.boolean(),
    question: z.string().min(1).max(20_000),
    options: z.array(questionOptionSchema).max(26),
    tags: z.array(z.string().min(1).max(100)).max(100),
    // 2011 年第 47 题含 102 个可追溯图像引用；128 是基于已核验数据留出的有界余量。
    assets: z.array(questionAssetReferenceSchema).max(128),
    content_format: z.literal("plain_text"),
    source: questionSourceSchema,
  })
  .strict()
  .superRefine((question, context) => {
    if (question.type === "choice" && question.options.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Choice questions require at least two options.",
        path: ["options"],
      });
    }
    if (question.type === "subjective" && question.options.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Subjective questions cannot expose choice options.",
        path: ["options"],
      });
    }
  });

export const questionPracticeItemSchema = z
  .object({
    question: questionDtoSchema,
    learning_metadata: questionLearningMetadataSchema,
    ranking: questionRankingExplanationSchema.nullable(),
  })
  .strict();

export const pastExamSubjectCountSchema = z
  .object({
    subject: z.string().trim().min(1).max(100),
    question_count: z.number().int().min(1).max(100),
  })
  .strict();

const complete408Subjects = new Set(["数据结构", "组成原理", "操作系统", "计算机网络"]);

export const pastExamPaperSummarySchema = z
  .object({
    year: z.number().int().min(1900).max(2100),
    question_count: z.number().int().min(1).max(100),
    choice_count: z.number().int().min(0).max(100),
    subjective_count: z.number().int().min(0).max(100),
    subjects: z.array(pastExamSubjectCountSchema).min(1).max(4),
    attempted_count: z.number().int().min(0).max(100),
    next_question_number: z.number().int().min(1).max(100).nullable(),
    is_complete: z.boolean(),
  })
  .strict()
  .superRefine((paper, context) => {
    if (paper.choice_count + paper.subjective_count !== paper.question_count) {
      context.addIssue({
        code: "custom",
        path: ["question_count"],
        message: "Past-paper question-type counts must equal the paper total.",
      });
    }
    const subjects = paper.subjects.map((item) => item.subject);
    if (new Set(subjects).size !== subjects.length) {
      context.addIssue({
        code: "custom",
        path: ["subjects"],
        message: "Past-paper subjects must be unique.",
      });
    }
    const subjectTotal = paper.subjects.reduce(
      (total, item) => total + item.question_count,
      0,
    );
    if (subjectTotal !== paper.question_count) {
      context.addIssue({
        code: "custom",
        path: ["subjects"],
        message: "Past-paper subject counts must equal the paper total.",
      });
    }
    if (paper.attempted_count > paper.question_count) {
      context.addIssue({
        code: "custom",
        path: ["attempted_count"],
        message: "Past-paper progress cannot exceed the paper total.",
      });
    }
    if (
      (paper.attempted_count === paper.question_count && paper.next_question_number !== null)
      || (paper.attempted_count < paper.question_count && paper.next_question_number === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["next_question_number"],
        message: "Past-paper next-question state does not match progress.",
      });
    }
    if (
      paper.next_question_number !== null
      && paper.next_question_number > paper.question_count
    ) {
      context.addIssue({
        code: "custom",
        path: ["next_question_number"],
        message: "Past-paper next question cannot exceed the paper total.",
      });
    }
    const completeSubjects = subjects.length === complete408Subjects.size
      && subjects.every((subject) => complete408Subjects.has(subject));
    const structurallyComplete = paper.question_count === 47
      && paper.choice_count === 40
      && paper.subjective_count === 7
      && completeSubjects;
    if (paper.is_complete && !structurallyComplete) {
      context.addIssue({
        code: "custom",
        path: ["is_complete"],
        message: "A complete past paper must match the verified 408 paper structure.",
      });
    }
  });

export const pastExamCatalogResponseSchema = z
  .object({
    items: z.array(pastExamPaperSummarySchema).max(30),
  })
  .strict();

export const practiceSelectionSchema = z
  .object({
    mode: practiceModeSchema.default("targeted"),
    subject: z.string().min(1).max(100).optional(),
    concept_id: idSchema.optional(),
    question_id: idSchema.optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    type: questionTypeSchema.optional(),
    tags: z.array(z.string().min(1).max(100)).max(20).default([]),
    tag_match: z.enum(["all", "any"]).default("all"),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.mode !== "past_exam") return;
    if (selection.year === undefined) {
      context.addIssue({
        code: "custom",
        path: ["year"],
        message: "Past-paper practice requires one paper year.",
      });
    }
    const scopedFields = ["subject", "concept_id", "question_id", "type"] as const;
    for (const field of scopedFields) {
      if (selection[field] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Past-paper practice cannot be split by question filters.",
        });
      }
    }
    if (selection.tags.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Past-paper practice cannot be split by tags.",
      });
    }
  });

const choiceAnswerSubmissionSchema = z
  .object({
    question_id: idSchema,
    concept_id: idSchema.optional(),
    answer_type: z.literal("choice"),
    selected_option_ids: z.array(idSchema).min(1).max(26),
  })
  .strict();

const subjectiveAnswerSubmissionSchema = z
  .object({
    question_id: idSchema,
    concept_id: idSchema.optional(),
    answer_type: z.literal("subjective"),
    response_text: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const answerSubmissionSchema = z.discriminatedUnion("answer_type", [
  choiceAnswerSubmissionSchema,
  subjectiveAnswerSubmissionSchema,
]);

export const mockExamStartRequestSchema = z
  .object({
    year: z.number().int().min(1900).max(2100).optional(),
  })
  .strict();

export const mockExamSubmitRequestSchema = z
  .object({
    answers: z.array(answerSubmissionSchema).max(100),
  })
  .strict()
  .superRefine((submission, context) => {
    const questionIds = submission.answers.map((answer) => answer.question_id);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "A mock-exam submission cannot answer the same question twice.",
      });
    }
  });

export const mockExamSessionSchema = z
  .object({
    session_id: idSchema,
    year: z.number().int().min(1900).max(2100),
    status: z.enum(["active", "submitted"]),
    duration_minutes: z.number().int().min(15).max(240),
    server_now: isoDateTimeSchema,
    started_at: isoDateTimeSchema,
    expires_at: isoDateTimeSchema,
    submitted_at: isoDateTimeSchema.nullable(),
    resumed: z.boolean(),
    questions: z.array(questionPracticeItemSchema).min(1).max(100),
  })
  .strict()
  .superRefine((session, context) => {
    if ((session.status === "submitted") !== (session.submitted_at !== null)) {
      context.addIssue({
        code: "custom",
        path: ["submitted_at"],
        message: "Submitted mock-exam sessions require a submission timestamp.",
      });
    }
  });

const questionEvaluationBaseSchema = z.object({
  evaluation_id: idSchema,
  submission_id: idSchema,
  question_id: idSchema,
  explanation: z.string().min(1).max(20_000).nullable(),
  reference_solution: z.string().min(1).max(30_000).nullable(),
  answer_assets: z.array(questionAssetReferenceSchema).max(100),
  created_at: isoDateTimeSchema,
  source: questionSourceSchema,
});

const deterministicQuestionEvaluationSchema = questionEvaluationBaseSchema
  .extend({
    grading_mode: z.literal("deterministic_choice"),
    status: z.enum(["correct", "incorrect"]),
    is_correct: z.boolean(),
    score: z.union([z.literal(0), z.literal(100)]),
    correct_option_ids: z.array(idSchema).min(1).max(26),
    review_required: z.literal(false),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if ((evaluation.status === "correct") !== evaluation.is_correct) {
      context.addIssue({
        code: "custom",
        message: "Choice evaluation status and correctness must agree.",
        path: ["is_correct"],
      });
    }
    if ((evaluation.is_correct ? 100 : 0) !== evaluation.score) {
      context.addIssue({
        code: "custom",
        message: "Choice evaluation score must be 100 when correct and 0 otherwise.",
        path: ["score"],
      });
    }
  });

const pendingQuestionEvaluationSchema = questionEvaluationBaseSchema
  .extend({
    grading_mode: z.literal("ai_or_teacher_review_required"),
    status: z.literal("pending_review"),
    is_correct: z.null(),
    score: z.null(),
    correct_option_ids: z.array(idSchema).max(0),
    review_required: z.literal(true),
  })
  .strict();

export const questionEvaluationResultSchema = z.union([
  deterministicQuestionEvaluationSchema,
  pendingQuestionEvaluationSchema,
]);

export const mockExamSubmissionResultSchema = z
  .object({
    session_id: idSchema,
    year: z.number().int().min(1900).max(2100),
    status: z.literal("submitted"),
    submitted_at: isoDateTimeSchema,
    question_count: z.number().int().positive().max(100),
    answered_count: z.number().int().nonnegative().max(100),
    unanswered_count: z.number().int().nonnegative().max(100),
    objective: z
      .object({
        question_count: z.number().int().nonnegative().max(100),
        answered_count: z.number().int().nonnegative().max(100),
        correct_count: z.number().int().nonnegative().max(100),
        score: z.number().int().nonnegative().max(100),
        max_score: z.number().int().nonnegative().max(100),
      })
      .strict(),
    subjective: z
      .object({
        question_count: z.number().int().nonnegative().max(100),
        submitted_count: z.number().int().nonnegative().max(100),
        pending_review_count: z.number().int().nonnegative().max(100),
      })
      .strict(),
    score_status: z.literal("partial_pending_subjective_review"),
    evaluations: z.array(questionEvaluationResultSchema).max(100),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.answered_count + result.unanswered_count !== result.question_count) {
      context.addIssue({
        code: "custom",
        path: ["answered_count"],
        message: "Answered and unanswered counts must cover the full paper.",
      });
    }
    if (
      result.objective.correct_count > result.objective.answered_count
      || result.objective.answered_count > result.objective.question_count
      || result.objective.score !== result.objective.correct_count * 2
      || result.objective.max_score !== result.objective.question_count * 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["objective"],
        message: "Objective mock-exam counts and two-point score must agree.",
      });
    }
    if (
      result.subjective.pending_review_count > result.subjective.submitted_count
      || result.subjective.submitted_count > result.subjective.question_count
      || result.answered_count
        !== result.objective.answered_count + result.subjective.submitted_count
    ) {
      context.addIssue({
        code: "custom",
        path: ["subjective"],
        message: "Subjective and overall mock-exam counts must agree.",
      });
    }
  });

export const practiceLearningEvidenceSchema = z
  .object({
    evidence_id: idSchema,
    evaluation_id: idSchema,
    submission_id: idSchema,
    question_id: idSchema,
    concept_id: idSchema.nullable().optional(),
    subject: z.string().min(1).max(100),
    year: z.number().int().min(1900).max(2100).nullable(),
    question_type: questionTypeSchema,
    outcome: z.enum(["correct", "incorrect", "pending_review"]),
    grading_mode: z.enum(["deterministic_choice", "ai_or_teacher_review_required"]),
    selected_option_ids: z.array(idSchema).max(26).nullable(),
    response_present: z.boolean(),
    tags: z.array(z.string().min(1).max(100)).max(100),
    review_required: z.boolean(),
    eligible_for_learning_state_update: z.boolean(),
    persistence_status: z.enum(["not_persisted", "persisted"]),
    created_at: isoDateTimeSchema,
    source: questionSourceSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.outcome === "pending_review" &&
      evidence.eligible_for_learning_state_update
    ) {
      context.addIssue({
        code: "custom",
        message: "Pending review evidence cannot update learning state.",
        path: ["eligible_for_learning_state_update"],
      });
    }
  });

export const questionManagementRecordSchema = z
  .object({
    question: questionDtoSchema,
    course_id: idSchema,
    import_batch_id: idSchema,
    review_status: reviewStatusSchema,
    reviewed_by: idSchema.nullable(),
    reviewed_at: isoDateTimeSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const practiceAttemptRecordSchema = z
  .object({
    attempt_id: idSchema,
    user_id: idSchema,
    course_id: idSchema,
    question_id: idSchema,
    concept_id: idSchema.nullable().optional(),
    answer_type: z.enum(["choice", "subjective"]),
    selected_option_ids: z.array(idSchema).max(26).nullable(),
    response_text: z.string().min(1).max(20_000).nullable(),
    status: z.enum(["submitted", "evaluated", "pending_review"]),
    submitted_at: isoDateTimeSchema,
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.answer_type === "choice" && !attempt.selected_option_ids?.length) {
      context.addIssue({
        code: "custom",
        message: "Choice attempts require selected options.",
        path: ["selected_option_ids"],
      });
    }
    if (attempt.answer_type === "subjective" && !attempt.response_text) {
      context.addIssue({
        code: "custom",
        message: "Subjective attempts require response text.",
        path: ["response_text"],
      });
    }
  });

export const materialCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    material_type: z.enum([
      "course_handout",
      "textbook",
      "exercise_set",
      "reference",
      "other",
    ]),
    source_url: z.string().url().nullable(),
    storage_ref: z.string().min(1).max(1_000).nullable(),
    license_status: licenseStatusSchema.default("unverified"),
  })
  .strict()
  .superRefine((material, context) => {
    if (!material.source_url && !material.storage_ref) {
      context.addIssue({
        code: "custom",
        message: "Material requires a source URL or storage reference.",
        path: ["source_url"],
      });
    }
  });

export const questionReviewUpdateSchema = z
  .object({
    review_status: z.enum(["pending_review", "approved", "rejected"]),
    review_note: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const managedQuestionSummarySchema = z
  .object({
    question_id: idSchema,
    course_id: idSchema,
    year: z.number().int().min(1900).max(2100).nullable(),
    number: z.number().int().positive(),
    subject: z.string().min(1).max(100),
    type: questionTypeSchema,
    tags: z.array(z.string().min(1).max(100)).max(100),
    source_url: z.string().url(),
    license_status: licenseStatusSchema,
    usage_scope: z.enum(["local_demo_only", "authorized_product_use"]),
    review_status: reviewStatusSchema,
    reviewed_by: idSchema.nullable(),
    reviewed_at: isoDateTimeSchema.nullable(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const courseLearningSummarySchema = z
  .object({
    course_id: idSchema,
    active_students: z.number().int().nonnegative(),
    attempt_count: z.number().int().nonnegative(),
    deterministic_correct_count: z.number().int().nonnegative(),
    deterministic_incorrect_count: z.number().int().nonnegative(),
    pending_review_count: z.number().int().nonnegative(),
    evidence_count: z.number().int().nonnegative(),
    generated_at: isoDateTimeSchema,
    data_scope: z.literal("stored_records_only"),
  })
  .strict();

export const academicDataProvenanceSchema = z.enum([
  "synthetic_demo",
  "user_provided",
  "institution_verified",
  "registered_account",
]);

export const studentLearningStatusSchema = z.enum([
  "on_track",
  "needs_attention",
  "inactive",
]);

// Authorized teachers can see the academic roster for their assigned course.
// Credentials, answer keys and full AI conversations never cross this DTO.
export const managedCourseStudentSchema = z
  .object({
    student_code: z.string().regex(/^P[A-Z0-9]{8}$/u),
    display_name: z.string().min(1).max(100),
    student_number: z.string().regex(/^(?:\d{10}|P[A-Z0-9]{8})$/u),
    cohort_year: z.number().int().min(2000).max(2100).nullable(),
    major: z.string().min(1).max(100).nullable(),
    class_name: z.string().min(1).max(100).nullable(),
    onboarding_status: onboardingStatusSchema,
    last_active_at: isoDateTimeSchema.nullable(),
    plan_completion_percent: z.number().int().min(0).max(100),
    accuracy_percent: z.number().int().min(0).max(100),
    correct_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    evidence_count: z.number().int().nonnegative(),
    pending_review_mistake_count: z.number().int().nonnegative(),
    // Legacy field; activity timestamps do not measure duration. New teacher UI uses recent_attempt_count.
    weekly_study_minutes: z.number().int().nonnegative().max(10_080),
    current_focus: z.string().min(1).max(200).nullable(),
    focus_source: z.enum(["reading", "practice", "experiment", "probe", "demo_snapshot", "none"]).optional(),
    recent_attempt_count: z.number().int().nonnegative().optional(),
    learning_status: studentLearningStatusSchema,
    data_provenance: academicDataProvenanceSchema,
  })
  .strict();

export const managedCourseTeacherSchema = z
  .object({
    display_name: z.string().min(1).max(100),
    teacher_number: z.string().min(4).max(32),
    department: z.string().min(1).max(120),
    professional_title: z.string().min(1).max(50),
    assigned_classes: z.array(z.string().min(1).max(100)).max(50),
    data_provenance: academicDataProvenanceSchema,
  })
  .strict();

export const managedLearningDataScopeSchema = z.enum([
  "stored_records_only",
  "includes_synthetic_demo",
]);

export const managedCourseEvidenceSourceScopeSchema = z.enum([
  "real_trial_only",
  "real_and_synthetic",
]);

export const managedCourseEvidenceQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).optional(),
    start_at: isoDateTimeSchema.optional(),
    end_at: isoDateTimeSchema.optional(),
    source_scope: managedCourseEvidenceSourceScopeSchema.default("real_and_synthetic"),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.start_at && query.end_at && Date.parse(query.start_at) >= Date.parse(query.end_at)) {
      context.addIssue({
        code: "custom",
        path: ["end_at"],
        message: "Evidence window end_at must be after start_at.",
      });
    }
    if (query.start_at && query.end_at) {
      const spanMs = Date.parse(query.end_at) - Date.parse(query.start_at);
      if (spanMs > 90 * 24 * 60 * 60 * 1_000) {
        context.addIssue({
          code: "custom",
          path: ["end_at"],
          message: "Evidence window cannot exceed 90 days.",
        });
      }
    }
  });

export const managedCourseStudentListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    page_size: z.coerce.number().int().min(1).max(50).default(15),
    class_name: z.string().trim().min(1).max(100).default("assigned"),
    learning_status: z.union([studentLearningStatusSchema, z.literal("all")]).default("all"),
  })
  .strict();

export const managedCourseStudentPaginationSchema = z
  .object({
    page: z.number().int().min(1),
    page_size: z.number().int().min(1).max(50),
    total_items: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
  })
  .strict();

export const managedCourseStudentFiltersSchema = z
  .object({
    class_name: z.string().min(1).max(100),
    learning_status: z.union([studentLearningStatusSchema, z.literal("all")]),
    available_classes: z.array(z.string().min(1).max(100)).max(100),
  })
  .strict();

export const managedCourseStudentSummarySchema = z
  .object({
    student_count: z.number().int().nonnegative(),
    attention_count: z.number().int().nonnegative(),
    average_progress_percent: z.number().int().min(0).max(100),
    average_accuracy_percent: z.number().int().min(0).max(100),
    weekly_study_minutes: z.number().int().nonnegative(),
    evidence_count: z.number().int().nonnegative(),
  })
  .strict();

export const managedCourseStudentListSchema = z
  .object({
    course_id: idSchema,
    items: z.array(managedCourseStudentSchema).max(50),
    teachers: z.array(managedCourseTeacherSchema).max(20).default([]),
    generated_at: isoDateTimeSchema,
    data_scope: managedLearningDataScopeSchema,
    pagination: managedCourseStudentPaginationSchema,
    filters: managedCourseStudentFiltersSchema,
    summary: managedCourseStudentSummarySchema,
  })
  .strict();

export const teacherInterventionActionSchema = z.enum([
  "assign_review",
  "recommend_material",
  "classroom_focus",
]);

export const teacherInterventionTargetTypeSchema = z.enum([
  "concept",
  "class",
  "student",
]);

export const teacherInterventionStatusSchema = z.enum([
  "planned",
  "sent",
  "completed",
  "cancelled",
]);

const teacherInterventionStudentCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^P[A-Z0-9]{8}$/u));

export const teacherInterventionCreateRequestSchema = z
  .object({
    concept_id: idSchema,
    action: teacherInterventionActionSchema,
    note: z.string().trim().min(1).max(500),
    target_type: teacherInterventionTargetTypeSchema.optional(),
    target_class_id: idSchema.nullable().optional(),
    target_student_code: teacherInterventionStudentCodeSchema.nullable().optional(),
    material_ref: z.string().trim().min(1).max(500).nullable().optional(),
    due_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const targetType = input.target_type ?? "concept";
    const hasStudentCode = Boolean(input.target_student_code);
    if (targetType === "class" && !input.target_class_id) {
      context.addIssue({
        code: "custom",
        path: ["target_class_id"],
        message: "A class intervention requires target_class_id.",
      });
    }
    if (targetType === "class" && hasStudentCode) {
      context.addIssue({
        code: "custom",
        path: ["target_student_code"],
        message: "A class intervention cannot include a student target.",
      });
    }
    if (targetType === "student" && !hasStudentCode) {
      context.addIssue({
        code: "custom",
        path: ["target_student_code"],
        message: "A student intervention requires target_student_code.",
      });
    }
    if (targetType === "student" && input.target_class_id) {
      context.addIssue({
        code: "custom",
        path: ["target_class_id"],
        message: "A student intervention cannot include target_class_id.",
      });
    }
    if (targetType === "concept" && (input.target_class_id || hasStudentCode)) {
      context.addIssue({
        code: "custom",
        path: ["target_type"],
        message: "A concept intervention cannot include a class or student target.",
      });
    }
  });

export const teacherInterventionStatusUpdateRequestSchema = z
  .object({
    status: z.enum(["sent", "completed", "cancelled"]),
  })
  .strict();

export const teacherInterventionSchema = z
  .object({
    intervention_id: idSchema,
    course_id: idSchema,
    concept_id: idSchema,
    concept_title: z.string().min(1).max(200),
    action: teacherInterventionActionSchema,
    note: z.string().trim().min(1).max(500),
    target_type: teacherInterventionTargetTypeSchema.optional(),
    target_class_id: idSchema.nullable().optional(),
    target_class_name: z.string().trim().min(1).max(100).nullable().optional(),
    target_student_code: teacherInterventionStudentCodeSchema.nullable().optional(),
    material_ref: z.string().min(1).max(500).nullable().optional(),
    due_at: isoDateTimeSchema.nullable().optional(),
    status: teacherInterventionStatusSchema.optional(),
    delivered_at: isoDateTimeSchema.nullable().optional(),
    completed_at: isoDateTimeSchema.nullable().optional(),
    evidence_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const managedCourseWeakConceptSchema = z
  .object({
    concept_id: idSchema,
    concept_title: z.string().min(1).max(200),
    attempt_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    pending_review_count: z.number().int().nonnegative(),
    student_count: z.number().int().nonnegative(),
    last_activity_at: isoDateTimeSchema.nullable(),
    valid_attempt_count: z.number().int().nonnegative().optional(),
    incorrect_student_count: z.number().int().nonnegative().optional(),
    error_rate: z.number().min(0).max(100).optional(),
    probe_participant_count: z.number().int().nonnegative().optional(),
    probe_correct_count: z.number().int().nonnegative().optional(),
    probe_incorrect_count: z.number().int().nonnegative().optional(),
  })
  .strict();

export const managedCourseEvidenceSourceMetricSchema = z
  .object({
    student_count: z.number().int().nonnegative(),
    valid_attempt_count: z.number().int().nonnegative(),
    incorrect_count: z.number().int().nonnegative(),
    error_rate: z.number().min(0).max(100),
  })
  .strict();

export const managedCourseEvidenceSourceBreakdownSchema = z
  .object({
    real_trial: managedCourseEvidenceSourceMetricSchema,
    synthetic_verification: managedCourseEvidenceSourceMetricSchema,
    local_demo: managedCourseEvidenceSourceMetricSchema,
  })
  .strict();

export const managedCourseEvidenceSampleSchema = z
  .object({
    minimum_students: z.number().int().positive(),
    active_student_count: z.number().int().nonnegative(),
    active_window_student_count: z.number().int().nonnegative(),
    valid_attempt_student_count: z.number().int().nonnegative(),
    real_trial_valid_attempt_student_count: z.number().int().nonnegative(),
    sufficient: z.boolean(),
  })
  .strict();

export const managedCourseEvidenceSchema = z
  .object({
    course_id: idSchema,
    generated_at: isoDateTimeSchema,
    data_scope: managedLearningDataScopeSchema,
    active_student_count: z.number().int().nonnegative(),
    top_weak_concepts: z.array(managedCourseWeakConceptSchema).max(3),
    recent_interventions: z.array(teacherInterventionSchema).max(20),
    window: z.object({
      start_at: isoDateTimeSchema,
      end_at: isoDateTimeSchema,
      days: z.number().int().positive(),
    }).strict().optional(),
    sample: managedCourseEvidenceSampleSchema.optional(),
    evidence_status: z.enum(["sufficient", "insufficient_sample", "no_valid_evidence"]).optional(),
    source_scope: managedCourseEvidenceSourceScopeSchema.optional(),
    source_breakdown: managedCourseEvidenceSourceBreakdownSchema.optional(),
  })
  .strict();

const studentNumberSchema = z.string().regex(/^\d{10}$/u);

const classInvitationCodeSchema = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u);

export const studentClassEnrollmentRequestCreateSchema = z
  .object({
    invite_code: z.string().trim().min(8).max(16).transform((value) => {
      const compact = value.replace(/[\s-]/gu, "").toUpperCase();
      return compact.length === 8
        ? `${compact.slice(0, 4)}-${compact.slice(4)}`
        : value.toUpperCase();
    }).pipe(classInvitationCodeSchema),
    student_number: studentNumberSchema,
  })
  .strict();

export const classEnrollmentRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const studentClassEnrollmentRequestSchema = z
  .object({
    request_id: idSchema,
    status: classEnrollmentRequestStatusSchema,
    student_number: studentNumberSchema,
    class_id: idSchema,
    class_name: z.string().min(1).max(100),
    course_id: idSchema,
    course_title: z.string().min(1).max(200),
    submitted_at: isoDateTimeSchema,
    reviewed_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const studentClassMembershipSchema = z
  .object({
    class_id: idSchema,
    class_name: z.string().min(1).max(100),
    cohort_year: z.number().int().min(2000).max(2100),
    major: z.string().min(1).max(100),
    student_number: studentNumberSchema,
    course_id: idSchema,
    course_title: z.string().min(1).max(200),
    joined_at: isoDateTimeSchema,
  })
  .strict();

export const studentClassEnrollmentStatusSchema = z
  .object({
    membership: studentClassMembershipSchema.nullable(),
    request: studentClassEnrollmentRequestSchema.nullable(),
  })
  .strict();

export const teacherClassCreateRequestSchema = z
  .object({
    class_name: z.string().trim().min(2).max(100),
    cohort_year: z.number().int().min(2000).max(2100),
    major: z.string().trim().min(1).max(100),
  })
  .strict();

export const teacherClassInvitationStateSchema = z
  .object({
    status: z.enum(["none", "active"]),
    code_hint: z.string().regex(/^\*{4}-[A-Z0-9]{4}$/u).nullable(),
    expires_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const teacherClassInvitationCreatedSchema = z
  .object({
    class_id: idSchema,
    invite_code: classInvitationCodeSchema,
    code_hint: z.string().regex(/^\*{4}-[A-Z0-9]{4}$/u),
    expires_at: isoDateTimeSchema,
  })
  .strict();

export const teacherManagedClassSchema = z
  .object({
    class_id: idSchema,
    class_name: z.string().min(1).max(100),
    cohort_year: z.number().int().min(2000).max(2100),
    major: z.string().min(1).max(100),
    member_count: z.number().int().nonnegative(),
    pending_request_count: z.number().int().nonnegative(),
    invitation: teacherClassInvitationStateSchema,
  })
  .strict();

export const teacherClassEnrollmentRequestSchema = z
  .object({
    request_id: idSchema,
    class_id: idSchema,
    class_name: z.string().min(1).max(100),
    student_code: z.string().regex(/^P[A-Z0-9]{8}$/u),
    display_name: z.string().min(1).max(100),
    student_number: studentNumberSchema,
    status: z.literal("pending"),
    submitted_at: isoDateTimeSchema,
  })
  .strict();

export const teacherClassMemberSchema = z
  .object({
    class_id: idSchema,
    class_name: z.string().min(1).max(100),
    student_code: z.string().regex(/^P[A-Z0-9]{8}$/u),
    display_name: z.string().min(1).max(100),
    student_number: studentNumberSchema,
    joined_at: isoDateTimeSchema,
  })
  .strict();

export const teacherClassManagementSchema = z
  .object({
    course_id: idSchema,
    classes: z.array(teacherManagedClassSchema).max(100),
    pending_requests: z.array(teacherClassEnrollmentRequestSchema).max(500),
    members: z.array(teacherClassMemberSchema).max(2_000),
  })
  .strict();

export const classEnrollmentDecisionRequestSchema = z
  .object({ decision: z.enum(["approved", "rejected"]) })
  .strict();

export const classEnrollmentCancellationSchema = z
  .object({ cancelled: z.literal(true) })
  .strict();

export const classInvitationRevocationSchema = z
  .object({ revoked: z.literal(true) })
  .strict();

export const classMemberRemovalSchema = z
  .object({ removed: z.literal(true) })
  .strict();

export const communityTopicSchema = z.enum([
  "择校交流",
  "备考规划",
  "课程讨论",
  "经验复盘",
]);

export const communityPostSortSchema = z.enum(["recent", "popular", "mine"]);

const normalizedCommunityTextSchema = (minimum: number, maximum: number) => z
  .string()
  .transform((value) => value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim())
  .pipe(z.string().min(minimum).max(maximum))
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value), {
    message: "内容包含不可见控制字符。",
  });

export const communityPostCreateRequestSchema = z
  .object({
    circle_id: idSchema,
    topic: communityTopicSchema,
    title: normalizedCommunityTextSchema(5, 80),
    body: normalizedCommunityTextSchema(10, 5_000),
  })
  .strict();

export const communityPostUpdateRequestSchema = z
  .object({
    topic: communityTopicSchema.optional(),
    title: normalizedCommunityTextSchema(5, 80).optional(),
    body: normalizedCommunityTextSchema(10, 5_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提供一个需要修改的字段。",
  });

export const communityReplyCreateRequestSchema = z
  .object({ body: normalizedCommunityTextSchema(2, 1_000) })
  .strict();

export const communityReplyUpdateRequestSchema = z
  .object({ body: normalizedCommunityTextSchema(2, 1_000).optional() })
  .strict()
  .refine((value) => value.body !== undefined, {
    message: "请提供需要修改的回复内容。",
  });

export const communityPostListQuerySchema = z
  .object({
    circle_id: idSchema.optional(),
    topic: communityTopicSchema.optional(),
    search: z.string().trim().min(1).max(80).optional(),
    sort: communityPostSortSchema.default("recent"),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(20).default(12),
  })
  .strict();

export const communityReplyListQuerySchema = z
  .object({
    reply_page: z.coerce.number().int().min(1).default(1),
    reply_page_size: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();

export const communityCircleReferenceSchema = z
  .object({
    circle_id: idSchema,
    school_name: z.string().min(1).max(120),
  })
  .strict();

export const communityCircleSummarySchema = communityCircleReferenceSchema.extend({
  description: z.string().min(1).max(180),
  member_count: z.number().int().nonnegative(),
  post_count: z.number().int().nonnegative(),
  is_my_target: z.boolean(),
}).strict();

export const communityCircleOverviewSchema = z
  .object({
    circles: z.array(communityCircleSummarySchema).max(100),
    current_target_circle_id: idSchema.nullable(),
  })
  .strict();

export const communityAuthorSchema = z
  .object({
    display_name: z.string().min(1).max(100),
    avatar_label: z.string().min(1).max(2),
    is_self: z.boolean(),
  })
  .strict();

export const communityContentOriginSchema = z.enum(["member", "sample"]);

export const communityPostSummarySchema = z
  .object({
    post_id: idSchema,
    circle: communityCircleReferenceSchema,
    topic: communityTopicSchema,
    title: z.string().min(5).max(80),
    excerpt: z.string().min(1).max(220),
    author: communityAuthorSchema,
    reply_count: z.number().int().nonnegative(),
    like_count: z.number().int().nonnegative(),
    view_count: z.number().int().nonnegative(),
    liked_by_me: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    last_activity_at: isoDateTimeSchema,
    content_origin: communityContentOriginSchema,
  })
  .strict();

export const communityPostListSchema = z
  .object({
    items: z.array(communityPostSummarySchema).max(20),
    page: z.number().int().min(1),
    page_size: z.number().int().min(1).max(20),
    total: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
  })
  .strict();

export const communityReplySchema = z
  .object({
    reply_id: idSchema,
    body: z.string().min(2).max(1_000),
    author: communityAuthorSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    content_origin: communityContentOriginSchema,
  })
  .strict();

export const communityPostDetailSchema = communityPostSummarySchema
  .omit({ excerpt: true })
  .extend({ body: z.string().min(10).max(5_000) })
  .strict();

export const communityPostDetailResponseSchema = z
  .object({
    post: communityPostDetailSchema,
    replies: z.array(communityReplySchema).max(50),
    reply_page: z.number().int().min(1),
    reply_page_size: z.number().int().min(1).max(50),
    reply_total: z.number().int().nonnegative(),
    reply_total_pages: z.number().int().nonnegative(),
  })
  .strict();

export const communityLikeRequestSchema = z
  .object({ liked: z.boolean() })
  .strict();

export const communityLikeStateSchema = z
  .object({
    liked: z.boolean(),
    like_count: z.number().int().nonnegative(),
  })
  .strict();

export const communityDeleteResultSchema = z
  .object({ deleted: z.literal(true) })
  .strict();

export const examPaperTypeSchema = z.enum(["exam", "sample"]);

export const examPaperContentModeSchema = z.enum(["text_layer", "scan"]);

export const examPaperFilterSchema = z
  .object({
    university: z.string().trim().min(1).max(200).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    subject: z.string().trim().min(1).max(300).optional(),
    paper_type: examPaperTypeSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();

export const examPaperSummarySchema = z
  .object({
    exam_paper_id: idSchema,
    university: z.string().min(1).max(200),
    year: z.number().int().min(1900).max(2100),
    subject: z.string().min(1).max(300),
    paper_type: examPaperTypeSchema,
    page_count: z.number().int().positive(),
    content_mode: examPaperContentModeSchema,
    official_source_url: z.string().url(),
    has_answer_key: z.literal(false),
    automatic_grading: z.literal(false),
  })
  .strict();

export const examPaperDetailSchema = examPaperSummarySchema
  .extend({
    landing_page_url: z.string().url(),
    file_size_bytes: z.number().int().positive(),
  })
  .strict();

export const examPaperFacetsSchema = z
  .object({
    universities: z.array(z.string().min(1).max(200)).max(500),
    years: z.array(z.number().int().min(1900).max(2100)).max(201),
    subjects: z.array(z.string().min(1).max(300)).max(1_000),
    paper_types: z.array(examPaperTypeSchema).max(2),
  })
  .strict();

export const examPaperListResponseSchema = z
  .object({
    items: z.array(examPaperSummarySchema).max(100),
    total: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    facets: examPaperFacetsSchema,
  })
  .strict();

export const examPaperManagementRecordSchema = examPaperDetailSchema
  .extend({
    course_id: idSchema,
    pdf_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    archive_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    license_status: licenseStatusSchema,
    usage_scope: z.literal("local_demo_only"),
    training_allowed: z.literal(false),
    review_status: reviewStatusSchema,
    reviewed_by: idSchema.nullable(),
    reviewed_at: isoDateTimeSchema.nullable(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const examPaperManagementResponseSchema = z
  .object({
    items: z.array(examPaperManagementRecordSchema).max(100),
    total: z.number().int().nonnegative(),
    scan_count: z.number().int().nonnegative(),
    text_layer_count: z.number().int().nonnegative(),
    license_unverified_count: z.number().int().nonnegative(),
    data_scope: z.literal("stored_records_only"),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.scan_count + response.text_layer_count !== response.total) {
      context.addIssue({
        code: "custom",
        message: "Content-mode counts must add up to the stored total.",
        path: ["scan_count"],
      });
    }
    if (response.license_unverified_count > response.total) {
      context.addIssue({
        code: "custom",
        message: "Unverified-license count cannot exceed the stored total.",
        path: ["license_unverified_count"],
      });
    }
  });

export const pilotParticipantKindSchema = z.enum([
  "real_trial",
  "synthetic_verification",
]);

export const pilotTaskStageSchema = z.enum(["baseline", "guided", "transfer"]);

export const pilotTaskEvidenceKindSchema = z.enum([
  "verified_choice_attempt",
  "verified_course_reading",
]);

export const pilotTaskStatusSchema = z.enum(["locked", "ready", "started", "completed"]);

export const pilotConsentRequestSchema = z
  .object({
    accepted: z.literal(true),
    notice_version: z.string().trim().min(1).max(80),
    baseline_confidence: z.number().int().min(1).max(5),
  })
  .strict();

export const pilotParticipantEnrollmentSchema = z
  .object({
    username: usernameInputSchema,
    participant_code: z.string().trim().regex(/^[A-Z][A-Z0-9_-]{2,15}$/u),
    role_label: z.string().trim().min(4).max(100),
    participant_kind: pilotParticipantKindSchema,
  })
  .strict();

export const pilotTaskCompletionRequestSchema = z
  .object({
    attempt_id: idSchema.optional(),
  })
  .strict();

export const pilotTaskEvaluationRequestSchema = z
  .object({
    selected_option_ids: z.array(idSchema).min(1).max(26),
  })
  .strict();

export const pilotTaskEvaluationResponseSchema = z
  .object({
    task_id: idSchema,
    attempt_id: idSchema,
    question_id: idSchema,
    outcome: z.enum(["correct", "incorrect"]),
    score: z.number().min(0).max(100),
    grading_mode: z.literal("deterministic_choice"),
    evidence_at: isoDateTimeSchema,
    task_completed: z.literal(true),
  })
  .strict();

export const pilotFeedbackRequestSchema = z
  .object({
    ease_of_use: z.number().int().min(1).max(5),
    guidance_helpfulness: z.number().int().min(1).max(5),
    confidence_after: z.number().int().min(1).max(5),
    continued_use_intent: z.number().int().min(1).max(5),
    open_feedback: z.string().trim().min(1).max(500),
  })
  .strict();

export const pilotTaskResultSchema = z
  .object({
    outcome: z.enum(["correct", "incorrect", "read"]),
    score: z.number().min(0).max(100).nullable(),
    grading_mode: z.enum(["deterministic_choice", "course_reading"]),
    evidence_at: isoDateTimeSchema,
  })
  .strict();

export const pilotTaskSchema = z
  .object({
    task_id: idSchema,
    ordinal: z.number().int().min(1).max(20),
    stage: pilotTaskStageSchema,
    evidence_kind: pilotTaskEvidenceKindSchema,
    title: z.string().min(1).max(160),
    instructions: z.string().min(1).max(1_000),
    course_id: idSchema,
    concept_id: idSchema.nullable(),
    question_id: idSchema.nullable(),
    href: z.string().startsWith("/student/").max(1_000),
    assistance_policy: z.enum(["independent", "platform_guidance"]),
    status: pilotTaskStatusSchema,
    started_at: isoDateTimeSchema.nullable(),
    completed_at: isoDateTimeSchema.nullable(),
    result: pilotTaskResultSchema.nullable(),
  })
  .strict();

export const pilotParticipantSchema = z
  .object({
    participant_code: z.string().regex(/^[A-Z][A-Z0-9_-]{2,15}$/u),
    role_label: z.string().min(4).max(100),
    participant_kind: pilotParticipantKindSchema,
    consent_notice_version: z.string().min(1).max(80).nullable(),
    consented_at: isoDateTimeSchema.nullable(),
    baseline_confidence: z.number().int().min(1).max(5).nullable(),
    completed_at: isoDateTimeSchema.nullable(),
  })
  .strict();

export const pilotStudyDescriptorSchema = z
  .object({
    study_id: idSchema,
    title: z.string().min(1).max(200),
    notice_version: z.string().min(1).max(80),
    notice_text: z.string().min(1).max(4_000),
  })
  .strict();

export const pilotFeedbackSchema = pilotFeedbackRequestSchema
  .extend({ submitted_at: isoDateTimeSchema })
  .strict();

export const pilotStudentStudySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not_enrolled") }).strict(),
  z
    .object({
      kind: z.literal("enrolled"),
      study: pilotStudyDescriptorSchema,
      participant: pilotParticipantSchema,
      tasks: z.array(pilotTaskSchema).max(20),
      feedback: pilotFeedbackSchema.nullable(),
    })
    .strict(),
]);

export const pilotReportTaskSchema = z
  .object({
    task_id: idSchema,
    ordinal: z.number().int().min(1).max(20),
    stage: pilotTaskStageSchema,
    title: z.string().min(1).max(160),
    started_at: isoDateTimeSchema.nullable(),
    completed_at: isoDateTimeSchema.nullable(),
    result: pilotTaskResultSchema.nullable(),
  })
  .strict();

export const pilotReportParticipantSchema = pilotParticipantSchema
  .extend({
    tasks: z.array(pilotReportTaskSchema).max(20),
    feedback: pilotFeedbackSchema.nullable(),
  })
  .strict();

const nullablePilotMetricSchema = z.number().finite().nullable();

export const pilotManagementSummarySchema = z
  .object({
    real_participants: z.number().int().nonnegative(),
    synthetic_participants: z.number().int().nonnegative(),
    consented_real_participants: z.number().int().nonnegative(),
    completed_real_participants: z.number().int().nonnegative(),
    baseline_evaluated_count: z.number().int().nonnegative(),
    baseline_correct_count: z.number().int().nonnegative(),
    transfer_evaluated_count: z.number().int().nonnegative(),
    transfer_correct_count: z.number().int().nonnegative(),
    baseline_correct_rate: nullablePilotMetricSchema,
    transfer_correct_rate: nullablePilotMetricSchema,
    observed_change_percentage_points: nullablePilotMetricSchema,
    average_completion_minutes: nullablePilotMetricSchema,
    average_ease_of_use: nullablePilotMetricSchema,
    average_guidance_helpfulness: nullablePilotMetricSchema,
    average_confidence_before: nullablePilotMetricSchema,
    average_confidence_after: nullablePilotMetricSchema,
    average_confidence_change: nullablePilotMetricSchema,
    average_continued_use_intent: nullablePilotMetricSchema,
  })
  .strict();

export const pilotManagementReportSchema = z
  .object({
    study: pilotStudyDescriptorSchema,
    generated_at: isoDateTimeSchema,
    data_scope: z.enum(["real_trial_only", "real_and_synthetic"]),
    claim_boundary: z.literal("small_sample_observational"),
    summary: pilotManagementSummarySchema,
    participants: z.array(pilotReportParticipantSchema).max(500),
  })
  .strict();

export const externalQuestionSubjectSchema = z.enum([
  "data_structures",
  "computer_organization",
  "operating_systems",
  "computer_networks",
]);

export const externalQuestionRecognitionSubjectSchema = z.union([
  externalQuestionSubjectSchema,
  z.literal("unknown"),
]);

export const externalQuestionTypeSchema = z.enum(["choice", "subjective"]);
export const externalQuestionRecognitionTypeSchema = z.union([
  externalQuestionTypeSchema,
  z.literal("unknown"),
]);
export const externalQuestionDepthSchema = z.enum(["direction", "steps", "complete"]);
export const externalQuestionStatusSchema = z.enum([
  "recognition_failed",
  "needs_better_image",
  "unsupported",
  "recognized",
  "confirmed",
]);

export const externalQuestionOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(10),
    text: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const externalQuestionRecognitionSchema = z
  .object({
    status: z.enum(["recognized", "needs_better_image", "unsupported"]),
    subject: externalQuestionRecognitionSubjectSchema,
    question_type: externalQuestionRecognitionTypeSchema,
    question_text: z.string().trim().max(20_000),
    options: z.array(externalQuestionOptionSchema).max(26),
    formulae: z.array(z.string().trim().min(1).max(2_000)).max(50),
    diagram_description: z.string().trim().min(1).max(8_000).nullable(),
    knowledge_keywords: z.array(z.string().trim().min(1).max(120)).max(30),
    warnings: z.array(z.string().trim().min(1).max(300)).max(10),
  })
  .strict()
  .superRefine((recognition, context) => {
    if (recognition.status !== "recognized") {
      if (recognition.warnings.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["warnings"],
          message: "Unrecognized images require a bounded warning.",
        });
      }
      return;
    }
    if (!recognition.question_text) {
      context.addIssue({
        code: "custom",
        path: ["question_text"],
        message: "Recognized questions require question text.",
      });
    }
    if (recognition.question_type === "choice" && recognition.options.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Recognized choice questions require at least two options.",
      });
    }
  });

export const externalQuestionConfirmationSchema = z
  .object({
    subject: externalQuestionSubjectSchema,
    question_type: externalQuestionTypeSchema,
    question_text: z.string().trim().min(1).max(20_000),
    options: z.array(externalQuestionOptionSchema).max(26),
    formulae: z.array(z.string().trim().min(1).max(2_000)).max(50),
    diagram_description: z.string().trim().min(1).max(8_000).nullable(),
  })
  .strict()
  .superRefine((confirmation, context) => {
    const labels = confirmation.options.map((option) => option.label.toLocaleUpperCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "External question option labels must be unique.",
      });
    }
    if (confirmation.question_type === "choice" && confirmation.options.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Confirmed choice questions require at least two options.",
      });
    }
    if (confirmation.question_type === "subjective" && confirmation.options.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Confirmed subjective questions cannot contain choice options.",
      });
    }
  });

const studentHrefSchema = z.string().min(1).max(1_000).regex(/^\/student\//u);

export const externalQuestionConceptCandidateSchema = z
  .object({
    concept_id: idSchema,
    course_id: idSchema,
    course_slug: z.enum([
      "data-structures",
      "computer-organization",
      "operating-systems",
      "computer-networks",
    ]),
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(300),
    reading_href: studentHrefSchema,
    practice_href: studentHrefSchema,
  })
  .strict();

export const externalQuestionKnowledgePointSchema = z
  .object({
    concept_id: idSchema,
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const externalQuestionExplanationSchema = z
  .object({
    depth: externalQuestionDepthSchema,
    summary: z.string().trim().min(1).max(1_000),
    knowledge_points: z.array(externalQuestionKnowledgePointSchema).max(3),
    approach: z.array(z.string().trim().min(1).max(1_000)).min(1).max(5),
    steps: z.array(z.string().trim().min(1).max(2_000)).max(12),
    self_check: z.string().trim().min(1).max(1_000),
    final_answer: z.string().trim().min(1).max(8_000).nullable(),
    uncertainty: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((explanation, context) => {
    if (explanation.depth !== "complete" && explanation.final_answer !== null) {
      context.addIssue({
        code: "custom",
        path: ["final_answer"],
        message: "Direction and steps explanations cannot include a final answer.",
      });
    }
  });

export const externalQuestionModelTraceSchema = z
  .object({
    requested_model: z.string().trim().min(1).max(200),
    provider_model: z.string().trim().min(1).max(200).nullable(),
    matched: z.boolean().nullable(),
    latency_ms: z.number().int().nonnegative(),
  })
  .strict();

export const externalQuestionExplanationRecordSchema = externalQuestionExplanationSchema
  .extend({
    explanation_id: idSchema,
    content_revision: z.number().int().positive(),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const externalQuestionDetailSchema = z
  .object({
    external_question_id: idSchema,
    status: externalQuestionStatusSchema,
    content_revision: z.number().int().nonnegative(),
    image_url: z.string().regex(
      /^\/api\/v1\/student\/external-questions\/[a-zA-Z0-9._:-]+\/image$/u,
    ),
    recognition: externalQuestionRecognitionSchema.nullable(),
    confirmation: externalQuestionConfirmationSchema.nullable(),
    concept_candidates: z.array(externalQuestionConceptCandidateSchema).max(8),
    explanations: z.array(externalQuestionExplanationRecordSchema).max(3),
    saved_at: isoDateTimeSchema.nullable(),
    expires_at: isoDateTimeSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const externalQuestionListItemSchema = z
  .object({
    external_question_id: idSchema,
    status: externalQuestionStatusSchema,
    subject: externalQuestionSubjectSchema.nullable(),
    question_excerpt: z.string().trim().min(1).max(240).nullable(),
    image_url: z.string().min(1).max(1_000),
    saved_at: isoDateTimeSchema.nullable(),
    expires_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const externalQuestionListSchema = z
  .object({ items: z.array(externalQuestionListItemSchema).max(100) })
  .strict();

export const externalQuestionExplanationRequestSchema = z
  .object({ depth: externalQuestionDepthSchema })
  .strict();

export const externalQuestionSaveRequestSchema = z.object({}).strict();

export type StudentProfile = z.infer<typeof studentProfileSchema>;
export type CourseSummary = z.infer<typeof courseSummarySchema>;
export type LearningNode = z.infer<typeof learningNodeSchema>;
export type CourseMapNode = z.infer<typeof courseMapNodeSchema>;
export type CourseMapEdge = z.infer<typeof courseMapEdgeSchema>;
export type CourseMap = z.infer<typeof courseMapSchema>;
export type ProgrammingLanguage = z.infer<typeof programmingLanguageSchema>;
export type CodeTemplate = z.infer<typeof codeTemplateSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Diagnosis = z.infer<typeof diagnosisSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type PracticeTaskSummary = z.infer<typeof practiceTaskSummarySchema>;
export type AbilityDimension = z.infer<typeof abilityDimensionSchema>;
export type LearningProfile = z.infer<typeof learningProfileSchema>;
export type AbilityAssessmentKey = z.infer<typeof abilityAssessmentKeySchema>;
export type AbilityAssessmentDimension = z.infer<typeof abilityAssessmentDimensionSchema>;
export type AbilityAssessment = z.infer<typeof abilityAssessmentSchema>;
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;
export type TraceVariant = z.infer<typeof traceVariantSchema>;
export type AlgorithmTraceStep = z.infer<typeof algorithmTraceStepSchema>;
export type AlgorithmTrace = z.infer<typeof algorithmTraceSchema>;
export type CodeRunRequest = z.infer<typeof codeRunRequestSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type CodeRunCaseStatus = z.infer<typeof codeRunCaseStatusSchema>;
export type CodeRunTestCase = z.infer<typeof codeRunTestCaseSchema>;
export type CodeRunResult = z.infer<typeof codeRunResultSchema>;
export type ProgrammingExperimentDefinition = z.infer<typeof programmingExperimentDefinitionSchema>;
export type ProgrammingExperimentAttemptSubmit = z.infer<typeof programmingExperimentAttemptSubmitSchema>;
export type ProgrammingExperimentDiagnosis = z.infer<typeof programmingExperimentDiagnosisSchema>;
export type ProgrammingExperimentAttemptRecord = z.infer<typeof programmingExperimentAttemptRecordSchema>;
export type ProgrammingExperimentHistory = z.infer<typeof programmingExperimentHistorySchema>;
export type ProgrammingExperimentOverview = z.infer<typeof programmingExperimentOverviewSchema>;
export type ProgrammingExperimentCatalog = z.infer<typeof programmingExperimentCatalogSchema>;
export type SubmissionHistoryItem = z.infer<typeof submissionHistoryItemSchema>;
export type SubmissionHistory = z.infer<typeof submissionHistorySchema>;
export type TutorHintLevel = z.infer<typeof tutorHintLevelSchema>;
export type TutorRequestedAction = z.infer<typeof tutorRequestedActionSchema>;
export type AgentMockScenario = z.infer<typeof agentMockScenarioSchema>;
export type TutorWorkspaceContext = z.infer<typeof tutorWorkspaceContextSchema>;
export type LearningSessionRequest = z.infer<typeof learningSessionRequestSchema>;
export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;
export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;
export type ValidationAttemptRequest = z.infer<typeof validationAttemptRequestSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type AccountStatus = z.infer<typeof accountStatusSchema>;
export type AuthSource = z.infer<typeof authSourceSchema>;
export type AccountOrigin = z.infer<typeof accountOriginSchema>;
export type AccountDataBoundary = z.infer<typeof accountDataBoundarySchema>;
export type AuthRegisterRequest = z.infer<typeof authRegisterRequestSchema>;
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
export type AuthAccount = z.infer<typeof authAccountSchema>;
export type AuthRegistrationResponse = z.infer<typeof authRegistrationResponseSchema>;
export type AccountCreateRequest = z.infer<typeof accountCreateRequestSchema>;
export type AccountStatusUpdate = z.infer<typeof accountStatusUpdateSchema>;
export type AdminPasswordResetRequest = z.infer<typeof adminPasswordResetRequestSchema>;
export type TeacherApprovalRequest = z.infer<typeof teacherApprovalRequestSchema>;
export type AcademicClassOption = z.infer<typeof academicClassOptionSchema>;
export type AcademicClassOptionList = z.infer<typeof academicClassOptionListSchema>;
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type AccountListResponse = z.infer<typeof accountListResponseSchema>;
export type StudentRegistrationPolicy = z.infer<typeof studentRegistrationPolicySchema>;
export type AccountCourseScope = z.infer<typeof accountCourseScopeSchema>;
export type PlatformUser = z.infer<typeof platformUserSchema>;
export type CourseRecord = z.infer<typeof courseRecordSchema>;
export type CourseMembership = z.infer<typeof courseMembershipSchema>;
export type CourseMaterialStatus = z.infer<typeof courseMaterialStatusSchema>;
export type CourseContentBoundary = z.infer<typeof courseContentBoundarySchema>;
export type CourseCatalogItem = z.infer<typeof courseCatalogItemSchema>;
export type CourseRecommendedStart = z.infer<typeof courseRecommendedStartSchema>;
export type CourseCatalogResponse = z.infer<typeof courseCatalogResponseSchema>;
export type SourceLayerStudentContentStatus = z.infer<typeof sourceLayerStudentContentStatusSchema>;
export type SourceLayerCourseSummary = z.infer<typeof sourceLayerCourseSummarySchema>;
export type SourceCourseCurriculumStatus = z.infer<typeof sourceCourseCurriculumStatusSchema>;
export type SourceCourseFigure = z.infer<typeof sourceCourseFigureSchema>;
export type SourceCourseEntry = z.infer<typeof sourceCourseEntrySchema>;
export type SourceCourseChapter = z.infer<typeof sourceCourseChapterSchema>;
export type SourceCourseOutline = z.infer<typeof sourceCourseOutlineSchema>;
export type CourseChapter = z.infer<typeof courseChapterSchema>;
export type CourseChapterList = z.infer<typeof courseChapterListSchema>;
export type CourseFigureAsset = z.infer<typeof courseFigureAssetSchema>;
export type CourseFigureReference = z.infer<typeof courseFigureReferenceSchema>;
export type CourseKnowledgeChunk = z.infer<typeof courseKnowledgeChunkSchema>;
export type CourseQaExample = z.infer<typeof courseQaExampleSchema>;
export type CourseContentPageQuery = z.infer<typeof courseContentPageQuerySchema>;
export type CourseKnowledgePage = z.infer<typeof courseKnowledgePageSchema>;
export type CourseQaPage = z.infer<typeof courseQaPageSchema>;
export type CourseReadingProgressUpdate = z.infer<typeof courseReadingProgressUpdateSchema>;
export type CourseReadingProgress = z.infer<typeof courseReadingProgressSchema>;
export type CourseReadingProgressResponse = z.infer<typeof courseReadingProgressResponseSchema>;
export type CourseConceptImportance = z.infer<typeof courseConceptImportanceSchema>;
export type CourseConceptReviewStatus = z.infer<typeof courseConceptReviewStatusSchema>;
export type CourseConceptSource = z.infer<typeof courseConceptSourceSchema>;
export type CourseConceptLearningNote = z.infer<typeof courseConceptLearningNoteSchema>;
export type CourseConceptLearningContent = z.infer<typeof courseConceptLearningContentSchema>;
export type CourseConceptFigureItem = z.infer<typeof courseConceptFigureItemSchema>;
export type CourseConceptFigureGuidance = z.infer<typeof courseConceptFigureGuidanceSchema>;
export type CourseConceptVideoItem = z.infer<typeof courseConceptVideoItemSchema>;
export type CourseConceptVideoList = z.infer<typeof courseConceptVideoListSchema>;
export type CourseVideoKind = z.infer<typeof courseVideoKindSchema>;
export type CourseVideoSeriesItem = z.infer<typeof courseVideoSeriesItemSchema>;
export type CourseVideoSeriesPage = z.infer<typeof courseVideoSeriesPageSchema>;
export type CourseVideoEpisodeItem = z.infer<typeof courseVideoEpisodeItemSchema>;
export type CourseVideoEpisodePage = z.infer<typeof courseVideoEpisodePageSchema>;
export type CourseCoreConcept = z.infer<typeof courseCoreConceptSchema>;
export type CourseLearningModule = z.infer<typeof courseLearningModuleSchema>;
export type CourseCurriculumChapter = z.infer<typeof courseCurriculumChapterSchema>;
export type CourseCurriculumMap = z.infer<typeof courseCurriculumMapSchema>;
export type StudentCareSignal = z.infer<typeof studentCareSignalSchema>;
export type StudentCareResponseAction = z.infer<typeof studentCareResponseActionSchema>;
export type StudentCareCurrentTask = z.infer<typeof studentCareCurrentTaskSchema>;
export type StudentCareLightStep = z.infer<typeof studentCareLightStepSchema>;
export type StudentCareInvitation = z.infer<typeof studentCareInvitationSchema>;
export type StudentCareLightSession = z.infer<typeof studentCareLightSessionSchema>;
export type StudentCareStatus = z.infer<typeof studentCareStatusSchema>;
export type StudentCareRespondRequest = z.infer<typeof studentCareRespondRequestSchema>;
export type StudentCarePreferenceUpdate = z.infer<typeof studentCarePreferenceUpdateSchema>;
export type StudentCarePreferenceRead = z.infer<typeof studentCarePreferenceReadSchema>;
export type StudentCarePreference = z.infer<typeof studentCarePreferenceSchema>;
export type StudentCareTalkDescriptor = z.infer<typeof studentCareTalkDescriptorSchema>;
export type StudentCareResponseResult = z.infer<typeof studentCareResponseResultSchema>;
export type AiWorkflowSlot = z.infer<typeof aiWorkflowSlotSchema>;
export type AiWorkflowCapability = z.infer<typeof aiWorkflowCapabilitySchema>;
export type AiWorkflowRuntimeState = z.infer<typeof aiWorkflowRuntimeStateSchema>;
export type AiWorkflowRuntimeStatus = z.infer<typeof aiWorkflowRuntimeStatusSchema>;
export type AiWorkflowInvocation = z.infer<typeof aiWorkflowInvocationSchema>;
export type AiWorkflowLearningEvidence = z.infer<typeof aiWorkflowLearningEvidenceSchema>;
export type AiWorkflowSourceChunk = z.infer<typeof aiWorkflowSourceChunkSchema>;
export type AiWorkflowReadingProgressContext = z.infer<
  typeof aiWorkflowReadingProgressContextSchema
>;
export type AiWorkflowConceptContext = z.infer<typeof aiWorkflowConceptContextSchema>;
export type AiWorkflowQaCaseContext = z.infer<typeof aiWorkflowQaCaseContextSchema>;
export type AiWorkflowAttemptContext = z.infer<typeof aiWorkflowAttemptContextSchema>;
export type AiWorkflowEvaluationContext = z.infer<
  typeof aiWorkflowEvaluationContextSchema
>;
export type AiWorkflowCareCheckInContext = z.infer<
  typeof aiWorkflowCareCheckInContextSchema
>;
export type AiWorkflowCareTurn = z.infer<typeof aiWorkflowCareTurnSchema>;
export type AiWorkflowContext = z.infer<typeof aiWorkflowContextSchema>;
export type AiWorkflowRequest = z.infer<typeof aiWorkflowRequestSchema>;
export type AiWorkflowDisplayBlock = z.infer<typeof aiWorkflowDisplayBlockSchema>;
export type AiWorkflowCitation = z.infer<typeof aiWorkflowCitationSchema>;
export type AiWorkflowEvidenceReference = z.infer<typeof aiWorkflowEvidenceReferenceSchema>;
export type AiWorkflowNextAction = z.infer<typeof aiWorkflowNextActionSchema>;
export type AiWorkflowFailure = z.infer<typeof aiWorkflowFailureSchema>;
export type AiWorkflowResponse = z.infer<typeof aiWorkflowResponseSchema>;
export type StudentProfileWorkflowStatus = z.infer<typeof studentProfileWorkflowStatusSchema>;
export type StudentProfileCourseEvidenceLevel = z.infer<typeof studentProfileCourseEvidenceLevelSchema>;
export type StudentProfileCourseProgress = z.infer<typeof studentProfileCourseProgressSchema>;
export type StudentProfileWorkflowRequest = z.infer<typeof studentProfileWorkflowRequestSchema>;
export type StudentProfileNextTask = z.infer<typeof studentProfileNextTaskSchema>;
export type StudentProfileEvidenceSummary = z.infer<typeof studentProfileEvidenceSummarySchema>;
export type StudentProfileWorkflowResponse = z.infer<typeof studentProfileWorkflowResponseSchema>;
export type MaterialRecord = z.infer<typeof materialRecordSchema>;
export type QuestionType = z.infer<typeof questionTypeSchema>;
export type PracticeMode = z.infer<typeof practiceModeSchema>;
export type QuestionSourceType = z.infer<typeof questionSourceTypeSchema>;
export type QuestionLearningMetadata = z.infer<typeof questionLearningMetadataSchema>;
export type QuestionRankingExplanation = z.infer<typeof questionRankingExplanationSchema>;
export type QuestionSource = z.infer<typeof questionSourceSchema>;
export type QuestionAssetReference = z.infer<typeof questionAssetReferenceSchema>;
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type QuestionDto = z.infer<typeof questionDtoSchema>;
export type QuestionPracticeItem = z.infer<typeof questionPracticeItemSchema>;
export type PastExamSubjectCount = z.infer<typeof pastExamSubjectCountSchema>;
export type PastExamPaperSummary = z.infer<typeof pastExamPaperSummarySchema>;
export type PastExamCatalogResponse = z.infer<typeof pastExamCatalogResponseSchema>;
export type PracticeSelection = z.infer<typeof practiceSelectionSchema>;
export type AnswerSubmission = z.infer<typeof answerSubmissionSchema>;
export type MockExamStartRequest = z.infer<typeof mockExamStartRequestSchema>;
export type MockExamSubmitRequest = z.infer<typeof mockExamSubmitRequestSchema>;
export type MockExamSession = z.infer<typeof mockExamSessionSchema>;
export type MockExamSubmissionResult = z.infer<typeof mockExamSubmissionResultSchema>;
export type QuestionEvaluationResult = z.infer<typeof questionEvaluationResultSchema>;
export type PracticeLearningEvidence = z.infer<typeof practiceLearningEvidenceSchema>;
export type QuestionManagementRecord = z.infer<typeof questionManagementRecordSchema>;
export type PracticeAttemptRecord = z.infer<typeof practiceAttemptRecordSchema>;
export type MaterialCreateRequest = z.infer<typeof materialCreateRequestSchema>;
export type QuestionReviewUpdate = z.infer<typeof questionReviewUpdateSchema>;
export type ManagedQuestionSummary = z.infer<typeof managedQuestionSummarySchema>;
export type CourseLearningSummary = z.infer<typeof courseLearningSummarySchema>;
export type ManagedCourseStudent = z.infer<typeof managedCourseStudentSchema>;
export type ManagedCourseStudentList = z.infer<typeof managedCourseStudentListSchema>;
export type ManagedCourseStudentListQuery = z.infer<typeof managedCourseStudentListQuerySchema>;
export type ManagedCourseStudentSummary = z.infer<typeof managedCourseStudentSummarySchema>;
export type ManagedCourseTeacher = z.infer<typeof managedCourseTeacherSchema>;
export type ManagedLearningDataScope = z.infer<typeof managedLearningDataScopeSchema>;
export type ManagedCourseEvidenceSourceScope = z.infer<typeof managedCourseEvidenceSourceScopeSchema>;
export type ManagedCourseEvidenceQuery = z.infer<typeof managedCourseEvidenceQuerySchema>;
export type AcademicDataProvenance = z.infer<typeof academicDataProvenanceSchema>;
export type StudentLearningStatus = z.infer<typeof studentLearningStatusSchema>;
export type TeacherInterventionAction = z.infer<typeof teacherInterventionActionSchema>;
export type TeacherInterventionTargetType = z.infer<typeof teacherInterventionTargetTypeSchema>;
export type TeacherInterventionStatus = z.infer<typeof teacherInterventionStatusSchema>;
export type TeacherInterventionCreateRequest = z.infer<typeof teacherInterventionCreateRequestSchema>;
export type TeacherInterventionStatusUpdateRequest = z.infer<typeof teacherInterventionStatusUpdateRequestSchema>;
export type TeacherIntervention = z.infer<typeof teacherInterventionSchema>;
export type ManagedCourseWeakConcept = z.infer<typeof managedCourseWeakConceptSchema>;
export type ManagedCourseEvidence = z.infer<typeof managedCourseEvidenceSchema>;
export type StudentClassEnrollmentRequestCreate = z.infer<typeof studentClassEnrollmentRequestCreateSchema>;
export type ClassEnrollmentRequestStatus = z.infer<typeof classEnrollmentRequestStatusSchema>;
export type StudentClassEnrollmentRequest = z.infer<typeof studentClassEnrollmentRequestSchema>;
export type StudentClassMembership = z.infer<typeof studentClassMembershipSchema>;
export type StudentClassEnrollmentStatus = z.infer<typeof studentClassEnrollmentStatusSchema>;
export type TeacherClassCreateRequest = z.infer<typeof teacherClassCreateRequestSchema>;
export type TeacherClassInvitationState = z.infer<typeof teacherClassInvitationStateSchema>;
export type TeacherClassInvitationCreated = z.infer<typeof teacherClassInvitationCreatedSchema>;
export type TeacherManagedClass = z.infer<typeof teacherManagedClassSchema>;
export type TeacherClassEnrollmentRequest = z.infer<typeof teacherClassEnrollmentRequestSchema>;
export type TeacherClassMember = z.infer<typeof teacherClassMemberSchema>;
export type TeacherClassManagement = z.infer<typeof teacherClassManagementSchema>;
export type ClassEnrollmentDecisionRequest = z.infer<typeof classEnrollmentDecisionRequestSchema>;
export type ClassEnrollmentCancellation = z.infer<typeof classEnrollmentCancellationSchema>;
export type ClassInvitationRevocation = z.infer<typeof classInvitationRevocationSchema>;
export type ClassMemberRemoval = z.infer<typeof classMemberRemovalSchema>;
export type CommunityTopic = z.infer<typeof communityTopicSchema>;
export type CommunityPostSort = z.infer<typeof communityPostSortSchema>;
export type CommunityPostCreateRequest = z.infer<typeof communityPostCreateRequestSchema>;
export type CommunityPostUpdateRequest = z.infer<typeof communityPostUpdateRequestSchema>;
export type CommunityReplyCreateRequest = z.infer<typeof communityReplyCreateRequestSchema>;
export type CommunityReplyUpdateRequest = z.infer<typeof communityReplyUpdateRequestSchema>;
export type CommunityPostListQuery = z.infer<typeof communityPostListQuerySchema>;
export type CommunityReplyListQuery = z.infer<typeof communityReplyListQuerySchema>;
export type CommunityCircleReference = z.infer<typeof communityCircleReferenceSchema>;
export type CommunityCircleSummary = z.infer<typeof communityCircleSummarySchema>;
export type CommunityCircleOverview = z.infer<typeof communityCircleOverviewSchema>;
export type CommunityAuthor = z.infer<typeof communityAuthorSchema>;
export type CommunityContentOrigin = z.infer<typeof communityContentOriginSchema>;
export type CommunityPostSummary = z.infer<typeof communityPostSummarySchema>;
export type CommunityPostList = z.infer<typeof communityPostListSchema>;
export type CommunityReply = z.infer<typeof communityReplySchema>;
export type CommunityPostDetail = z.infer<typeof communityPostDetailSchema>;
export type CommunityPostDetailResponse = z.infer<typeof communityPostDetailResponseSchema>;
export type CommunityLikeRequest = z.infer<typeof communityLikeRequestSchema>;
export type CommunityLikeState = z.infer<typeof communityLikeStateSchema>;
export type CommunityDeleteResult = z.infer<typeof communityDeleteResultSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type PracticeMistakeStatus = z.infer<typeof practiceMistakeStatusSchema>;
export type PracticeMistakeRecord = z.infer<typeof practiceMistakeRecordSchema>;
export type PracticeMistakeStatusUpdate = z.infer<typeof practiceMistakeStatusUpdateSchema>;
export type LearningConceptProgress = z.infer<typeof learningConceptProgressSchema>;
export type LearningCourseRecord = z.infer<typeof learningCourseRecordSchema>;
export type LearningRecord = z.infer<typeof learningRecordSchema>;
export type PersonalLearningDimensionKey = z.infer<typeof personalLearningDimensionKeySchema>;
export type PersonalLearningEvidenceLevel = z.infer<typeof personalLearningEvidenceLevelSchema>;
export type PersonalLearningDimension = z.infer<typeof personalLearningDimensionSchema>;
export type PersonalLearningNextAction = z.infer<typeof personalLearningNextActionSchema>;
export type PersonalLearningCourse = z.infer<typeof personalLearningCourseSchema>;
export type PersonalLearningDashboard = z.infer<typeof personalLearningDashboardSchema>;
export type OnboardingCourseId = z.infer<typeof onboardingCourseIdSchema>;
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;
export type OnboardingPreparationStage = z.infer<typeof onboardingPreparationStageSchema>;
export type OnboardingSelfAssessmentLevel = z.infer<typeof onboardingSelfAssessmentLevelSchema>;
export type OnboardingGoalInput = z.infer<typeof onboardingGoalInputSchema>;
export type OnboardingGoals = z.infer<typeof onboardingGoalsSchema>;
export type AdmissionsTargetSearchQuery = z.infer<typeof admissionsTargetSearchQuerySchema>;
export type AdmissionsTargetSearchResponse = z.infer<typeof admissionsTargetSearchResponseSchema>;
export type AdmissionsTargetSelection = z.infer<typeof admissionsTargetSelectionSchema>;
export type AdmissionsCurrentTarget = z.infer<typeof admissionsCurrentTargetSchema>;
export type OnboardingSelfAssessment = z.infer<typeof onboardingSelfAssessmentSchema>;
export type OnboardingSelfAssessmentsUpdate = z.infer<typeof onboardingSelfAssessmentsUpdateSchema>;
export type OnboardingDiagnosticResponseStatus = z.infer<typeof onboardingDiagnosticResponseStatusSchema>;
export type OnboardingDiagnosticAnswer = z.infer<typeof onboardingDiagnosticAnswerSchema>;
export type OnboardingDiagnosticQuestion = z.infer<typeof onboardingDiagnosticQuestionSchema>;
export type OnboardingDiagnosticQuestionSet = z.infer<typeof onboardingDiagnosticQuestionSetSchema>;
export type OnboardingDiagnosticQuestionSetResponse = z.infer<typeof onboardingDiagnosticQuestionSetResponseSchema>;
export type OnboardingScreeningSummary = z.infer<typeof onboardingScreeningSummarySchema>;
export type OnboardingRiskConcept = z.infer<typeof onboardingRiskConceptSchema>;
export type OnboardingCoursePriority = z.infer<typeof onboardingCoursePrioritySchema>;
export type OnboardingInitialProfile = z.infer<typeof onboardingInitialProfileSchema>;
export type OnboardingLearningTask = z.infer<typeof onboardingLearningTaskSchema>;
export type OnboardingLearningPlan = z.infer<typeof onboardingLearningPlanSchema>;
export type OnboardingDiagnosticSummary = z.infer<typeof onboardingDiagnosticSummarySchema>;
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export type StudentLearningEvidenceSummary = z.infer<typeof studentLearningEvidenceSummarySchema>;
export type StudentLearningOrchestrationTask = z.infer<typeof studentLearningOrchestrationTaskSchema>;
export type StudentLearningTaskCompletionRequest = z.infer<typeof studentLearningTaskCompletionRequestSchema>;
export type StudentLearningTaskActivation = z.infer<typeof studentLearningTaskActivationSchema>;
export type StudentLearningTaskSettlement = z.infer<typeof studentLearningTaskSettlementSchema>;
export type StudentLearningTaskCompletion = z.infer<typeof studentLearningTaskCompletionSchema>;
export type StudentLearningPlanTaskProgress = z.infer<typeof studentLearningPlanTaskProgressSchema>;
export type StudentLearningPlanProgress = z.infer<typeof studentLearningPlanProgressSchema>;
export type StudentLearningCoursePriority = z.infer<typeof studentLearningCoursePrioritySchema>;
export type StudentLearningChallengeNode = z.infer<typeof studentLearningChallengeNodeSchema>;
export type StudentLearningProfileUpdate = z.infer<typeof studentLearningProfileUpdateSchema>;
export type StudentLearningChallengeJourney = z.infer<typeof studentLearningChallengeJourneySchema>;
export type StudentLearningOrchestration = z.infer<typeof studentLearningOrchestrationSchema>;
export type ExamPaperType = z.infer<typeof examPaperTypeSchema>;
export type ExamPaperContentMode = z.infer<typeof examPaperContentModeSchema>;
export type ExamPaperFilter = z.infer<typeof examPaperFilterSchema>;
export type ExamPaperSummary = z.infer<typeof examPaperSummarySchema>;
export type ExamPaperDetail = z.infer<typeof examPaperDetailSchema>;
export type ExamPaperFacets = z.infer<typeof examPaperFacetsSchema>;
export type ExamPaperListResponse = z.infer<typeof examPaperListResponseSchema>;
export type ExamPaperManagementRecord = z.infer<
  typeof examPaperManagementRecordSchema
>;
export type ExamPaperManagementResponse = z.infer<
  typeof examPaperManagementResponseSchema
>;
export type PilotParticipantKind = z.infer<typeof pilotParticipantKindSchema>;
export type PilotTaskStage = z.infer<typeof pilotTaskStageSchema>;
export type PilotTaskEvidenceKind = z.infer<typeof pilotTaskEvidenceKindSchema>;
export type PilotTaskStatus = z.infer<typeof pilotTaskStatusSchema>;
export type PilotConsentRequest = z.infer<typeof pilotConsentRequestSchema>;
export type PilotParticipantEnrollment = z.infer<typeof pilotParticipantEnrollmentSchema>;
export type PilotTaskCompletionRequest = z.infer<typeof pilotTaskCompletionRequestSchema>;
export type PilotTaskEvaluationRequest = z.infer<typeof pilotTaskEvaluationRequestSchema>;
export type PilotTaskEvaluationResponse = z.infer<typeof pilotTaskEvaluationResponseSchema>;
export type PilotFeedbackRequest = z.infer<typeof pilotFeedbackRequestSchema>;
export type PilotTaskResult = z.infer<typeof pilotTaskResultSchema>;
export type PilotTask = z.infer<typeof pilotTaskSchema>;
export type PilotParticipant = z.infer<typeof pilotParticipantSchema>;
export type PilotStudyDescriptor = z.infer<typeof pilotStudyDescriptorSchema>;
export type PilotFeedback = z.infer<typeof pilotFeedbackSchema>;
export type PilotStudentStudy = z.infer<typeof pilotStudentStudySchema>;
export type PilotReportTask = z.infer<typeof pilotReportTaskSchema>;
export type PilotReportParticipant = z.infer<typeof pilotReportParticipantSchema>;
export type PilotManagementSummary = z.infer<typeof pilotManagementSummarySchema>;
export type PilotManagementReport = z.infer<typeof pilotManagementReportSchema>;
export type ExternalQuestionSubject = z.infer<typeof externalQuestionSubjectSchema>;
export type ExternalQuestionRecognitionSubject = z.infer<typeof externalQuestionRecognitionSubjectSchema>;
export type ExternalQuestionType = z.infer<typeof externalQuestionTypeSchema>;
export type ExternalQuestionRecognitionType = z.infer<typeof externalQuestionRecognitionTypeSchema>;
export type ExternalQuestionDepth = z.infer<typeof externalQuestionDepthSchema>;
export type ExternalQuestionStatus = z.infer<typeof externalQuestionStatusSchema>;
export type ExternalQuestionOption = z.infer<typeof externalQuestionOptionSchema>;
export type ExternalQuestionRecognition = z.infer<typeof externalQuestionRecognitionSchema>;
export type ExternalQuestionConfirmation = z.infer<typeof externalQuestionConfirmationSchema>;
export type ExternalQuestionConceptCandidate = z.infer<typeof externalQuestionConceptCandidateSchema>;
export type ExternalQuestionKnowledgePoint = z.infer<typeof externalQuestionKnowledgePointSchema>;
export type ExternalQuestionExplanation = z.infer<typeof externalQuestionExplanationSchema>;
export type ExternalQuestionModelTrace = z.infer<typeof externalQuestionModelTraceSchema>;
export type ExternalQuestionExplanationRecord = z.infer<typeof externalQuestionExplanationRecordSchema>;
export type ExternalQuestionDetail = z.infer<typeof externalQuestionDetailSchema>;
export type ExternalQuestionListItem = z.infer<typeof externalQuestionListItemSchema>;
export type ExternalQuestionList = z.infer<typeof externalQuestionListSchema>;
export type ExternalQuestionExplanationRequest = z.infer<typeof externalQuestionExplanationRequestSchema>;
export * from "./student-notebook.js";
export * from "./student-study-library.js";
