import type {
  LearningRecord,
  OnboardingState,
  PracticeMistakeRecord,
} from "@xuetu/contracts";
import { describe, expect, it } from "vitest";

import {
  buildStudentLearningOrchestration,
  type LearningOrchestrationInput,
} from "../src/services/orchestration/student-learning-orchestration.js";

const now = new Date("2026-08-12T08:00:00.000Z");

function onboarding(): OnboardingState {
  const courseIds = [
    "course_408_ds",
    "course_408_co",
    "course_408_os",
    "course_408_cn",
  ] as const;
  return {
    status: "completed",
    current_step: "plan",
    goals: {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 90,
      target_school: null,
      target_score: 120,
      saved_at: "2026-08-11T00:00:00.000Z",
    },
    self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" as const })),
    profile: {
      profile_id: "profile_001",
      version: 1,
      confidence: "low",
      evidence_status: "accumulating",
      confidence_explanation: "目前只依据学习设置形成起步方向。",
      generated_at: "2026-08-11T00:00:00.000Z",
      objective_evidence_count: 0,
      subjective_evidence_count: 4,
      priority_courses: courseIds.map((course_id, index) => ({
        course_id,
        course_title: ["数据结构", "计算机组成原理", "操作系统", "计算机网络"][index]!,
        priority: index === 0 ? "focus" as const : index === 1 ? "strengthen" as const : "maintain" as const,
        self_assessment: "average" as const,
        evidence_level: "self_report_only" as const,
        evidence_refs: [`self:${course_id}`],
        rationale: "当前仅依据学生自评安排起步顺序。",
      })),
      boundary_note: "这不是能力测评。",
    },
    plan: {
      plan_id: "plan_001",
      version: 1,
      source: "deterministic_fallback",
      ai_status: "unavailable",
      ai_status_message: "AI 个性化编排尚未接入。",
      start_date: "2026-08-12",
      daily_minutes: 90,
      generated_at: "2026-08-11T00:00:00.000Z",
      today_task_id: "task_ds_read",
      tasks: (courseIds.map((course_id, index) => ({
        task_id: index === 0 ? "task_ds_read" : `task_${index + 1}`,
        day_index: index + 1,
        task_date: `2026-08-${String(12 + index).padStart(2, "0")}`,
        order: 1,
        course_id,
        course_title: ["数据结构", "计算机组成原理", "操作系统", "计算机网络"][index]!,
        concept_id: ["ds_c01", "co_c01", "os_c01", "cn_c01"][index]!,
        concept_title: ["算法复杂度", "计算机系统层次", "操作系统作用", "协议分层"][index]!,
        task_type: "course_reading" as const,
        estimated_minutes: 30,
        title: `学习第 ${index + 1} 门课程`,
        reason: "根据首次设置安排。",
        completion_criteria: "开始阅读课程知识点。",
        href: [
          "/student/courses/data-structures",
          "/student/courses/computer-organization",
          "/student/courses/operating-systems",
          "/student/courses/computer-networks",
        ][index]!,
        evidence_refs: [`self:${course_id}`],
        status: "pending" as const,
      })) as OnboardingState["plan"] extends infer Plan
        ? Plan extends { tasks: infer Tasks }
          ? Tasks
          : never
        : never).concat([3, 4, 5].map((offset) => ({
        task_id: `task_extra_${offset}`,
        day_index: offset + 2,
        task_date: `2026-08-${String(14 + offset).padStart(2, "0")}`,
        order: 1,
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        concept_id: "ds_c01",
        concept_title: "算法复杂度",
        task_type: "choice_practice" as const,
        estimated_minutes: 30,
        title: "练习算法复杂度",
        reason: "巩固首周内容。",
        completion_criteria: "完成一次真实选择题训练。",
        href: "/student/practice?subject=数据结构&concept_id=ds_c01",
        evidence_refs: ["self:course_408_ds"],
        status: "pending" as const,
      }))),
    },
    updated_at: "2026-08-11T00:00:00.000Z",
  };
}

function learningRecord(overrides: Partial<LearningRecord["courses"][number]["concepts"][number]> = {}): LearningRecord {
  const courses = [
    ["course_408_ds", "数据结构", "ds_c01", "算法复杂度", 3],
    ["course_408_co", "计算机组成原理", "co_c01", "计算机系统层次", 2],
    ["course_408_os", "操作系统", "os_c01", "操作系统作用", 1],
    ["course_408_cn", "计算机网络", "cn_c01", "协议分层", 2],
  ] as const;
  return {
    generated_at: now.toISOString(),
    courses: courses.map(([course_id, title, concept_id, conceptTitle, questionCount], index) => {
      const concept = {
        concept_id,
        title: conceptTitle,
        status: "not_started" as const,
        attempt_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        mistake_count: 0,
        practice_question_count: questionCount,
        ...(index === 0 ? overrides : {}),
      };
      return {
        course_id,
        title,
        concept_count: 1,
        started_concept_count: concept.status === "not_started" ? 0 : 1,
        practice_attempt_count: concept.attempt_count,
        correct_count: concept.correct_count,
        incorrect_count: concept.incorrect_count,
        needs_review_count: concept.status === "needs_review" ? 1 : 0,
        mastered_count: concept.status === "mastered" ? 1 : 0,
        concepts: [concept],
      };
    }),
  };
}

const resources: LearningOrchestrationInput["courseResources"] = [
  { courseId: "course_408_ds", courseTitle: "数据结构", courseSlug: "data-structures", subject: "数据结构" },
  { courseId: "course_408_co", courseTitle: "计算机组成原理", courseSlug: "computer-organization", subject: "组成原理" },
  { courseId: "course_408_os", courseTitle: "操作系统", courseSlug: "operating-systems", subject: "操作系统" },
  { courseId: "course_408_cn", courseTitle: "计算机网络", courseSlug: "computer-networks", subject: "计算机网络" },
];

function input(options: Partial<LearningOrchestrationInput> = {}): LearningOrchestrationInput {
  return {
    onboarding: onboarding(),
    learningRecord: learningRecord(),
    mistakes: [],
    readingProgress: [],
    courseResources: resources,
    now,
    ...options,
  };
}

function mistake(status: "needs_review" | "mastered" = "needs_review"): PracticeMistakeRecord {
  return {
    mistake_id: "mistake_001",
    course_id: "course_408_ds",
    course_title: "数据结构",
    question_id: "question_001",
    question_year: 2026,
    question_number: 1,
    subject: "数据结构",
    concept_id: "ds_c01",
    concept_title: "算法复杂度",
    matched_tag: "时间复杂度",
    match_method: "exact_question_tag",
    first_incorrect_attempt_id: "attempt_001",
    last_incorrect_attempt_id: "attempt_001",
    last_incorrect_evaluation_id: "evaluation_001",
    wrong_count: 1,
    status,
    latest_attempt_outcome: status === "mastered" ? "correct" : "incorrect",
    first_incorrect_at: "2026-08-12T07:00:00.000Z",
    last_incorrect_at: "2026-08-12T07:00:00.000Z",
    mastered_at: status === "mastered" ? "2026-08-12T07:30:00.000Z" : null,
    updated_at: status === "mastered" ? "2026-08-12T07:30:00.000Z" : "2026-08-12T07:00:00.000Z",
  };
}

describe("student learning orchestration", () => {
  it("does not schedule an unresolved mistake before its review cycle is due", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "needs_review", attempt_count: 1, incorrect_count: 1, mistake_count: 1 }),
      mistakes: [mistake()],
    }));

    expect(result.current_task.source).not.toBe("mistake");
    expect(result.current_task.mistake_id).toBeNull();
    expect(result.course_priorities[0]).toMatchObject({ course_id: "course_408_ds", needs_review_count: 1 });
  });

  it("marks a due deterministic mistake as the current review challenge", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "needs_review", attempt_count: 1, incorrect_count: 1, mistake_count: 1 }),
      mistakes: [mistake()],
      recommendations: [{
        mistake_id: "mistake_001",
        course_id: "course_408_ds",
        course_title: "数据结构",
        question_id: "question_001",
        question_number: 1,
        concept_id: "ds_c01",
        concept_title: "算法复杂度",
        priority_score: 86,
        algorithm_version: "evidence_weighted_v1",
        next_review_at: "2026-08-12T07:00:00.000Z",
        due_status: "due",
        evidence_level: "grounded",
        reason_lines: ["已到复习时间", "同一题已错 1 次"],
        evidence_refs: ["mistake:mistake_001", "concept:ds_c01"],
        practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c01",
      }],
    }));

    const current = result.challenge_journey.nodes.find((node) => (
      node.node_id === result.challenge_journey.current_node_id
    ));
    expect(current).toMatchObject({
      task_id: result.current_task.task_id,
      kind: "mistake_review",
      status: "review_due",
    });
    expect(result.current_task.task_id).toBe(
      `review_mistake_001_${Date.parse("2026-08-12T07:00:00.000Z")}`,
    );
    expect(result.current_task.reason).toBe("已到复习时间；同一题已错 1 次");
  });

  it("restores an active mistake task with a student-facing reason", () => {
    const result = buildStudentLearningOrchestration(input({
      activeAssignment: {
        taskId: "live_mistake_001",
        taskType: "mistake_review",
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        mistakeId: "mistake_001",
        activatedAt: "2026-08-12T07:00:00.000Z",
      },
      learningRecord: learningRecord({ status: "needs_review", attempt_count: 1, incorrect_count: 1, mistake_count: 1 }),
      mistakes: [mistake()],
    }));

    expect(result.current_task.reason).toBe("这道选择题累计答错 1 次，先处理未完成的错题复习。");
  });

  it("promotes an offered learning probe to the single resumable current task", () => {
    const result = buildStudentLearningOrchestration({
      ...input(),
      pendingProbe: {
        probeSessionId: "probe_session_001",
        status: "offered",
        courseId: "course_408_co",
        conceptId: "co_c01",
        conceptTitle: "计算机系统层次",
        sourceAttemptId: "attempt_co_001",
        offeredAt: "2026-08-12T07:30:00.000Z",
      },
    } as LearningOrchestrationInput);

    expect(result.current_task).toMatchObject({
      source: "probe",
      task_type: "choice_practice",
      task_id: "probe_probe_session_001",
      course_id: "course_408_co",
      concept_id: "co_c01",
      probe_session_id: "probe_session_001",
    });
    expect(result.current_task.href).toContain("probe_session_id=probe_session_001");
  });

  it("counts distinct task-completion days in the latest seven-day window", () => {
    const result = buildStudentLearningOrchestration(input({
      completedTaskIds: ["completed_ds_read", "completed_co_read", "completed_ds_practice"],
      completedAssignments: [
        {
          taskId: "completed_ds_read",
          taskType: "course_reading",
          courseId: "course_408_ds",
          conceptId: "ds_c01",
          completedAt: "2026-08-11T08:00:00.000Z",
        },
        {
          taskId: "completed_co_read",
          taskType: "course_reading",
          courseId: "course_408_co",
          conceptId: "co_c01",
          completedAt: "2026-08-11T09:00:00.000Z",
        },
        {
          taskId: "completed_ds_practice",
          taskType: "choice_practice",
          courseId: "course_408_ds",
          conceptId: "ds_c01",
          completedAt: "2026-08-08T09:00:00.000Z",
        },
      ],
    }));

    expect(result.challenge_journey.recent_activity.completed_day_count).toBe(2);
    expect(result.challenge_journey.recent_activity.days).toHaveLength(7);
    expect(result.challenge_journey.recent_activity.days.filter((day) => day.completed))
      .toEqual([
        { date: "2026-08-08", completed: true },
        { date: "2026-08-11", completed: true },
      ]);
  });

  it("continues an unexpanded reading position without inferring plan completion", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "reading" }),
      readingProgress: [{
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        chunkId: "ds_k0002",
        paragraphIndex: 1,
        sourceExpanded: false,
        updatedAt: "2026-08-12T07:30:00.000Z",
      }],
    }));

    expect(result.plan_progress.tasks[0]).toMatchObject({ status: "pending" });
    expect(result.current_task).toMatchObject({
      source: "reading_progress",
      task_type: "course_reading",
      concept_id: "ds_c01",
    });
  });

  it("marks only the exact server-completed plan task when several days reuse one concept", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({
        status: "practiced",
        attempt_count: 1,
        correct_count: 1,
        practice_question_count: 3,
      }),
      completedTaskIds: ["task_extra_3"],
      completedAssignments: [{
        taskId: "task_extra_3",
        taskType: "choice_practice",
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        completedAt: "2026-08-12T07:30:00.000Z",
      }],
    }));

    expect(result.plan_progress.tasks.filter((task) => task.status === "completed").map((task) => task.task_id))
      .toEqual(["task_extra_3"]);
    expect(result.plan_progress.tasks.find((task) => task.task_id === "task_extra_4"))
      .toMatchObject({ status: "pending" });
  });

  it("moves an expanded, unpracticed concept to precise reliable practice", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "reading", practice_question_count: 3 }),
      readingProgress: [{
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        chunkId: "ds_k0002",
        paragraphIndex: 3,
        sourceExpanded: true,
        updatedAt: "2026-08-12T07:30:00.000Z",
      }],
    }));

    expect(result.current_task).toMatchObject({ task_type: "choice_practice", practice_question_count: 3 });
    expect(result.current_task.href).toContain("concept_id=ds_c01");
  });

  it("does not select completed precise practice again", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({
        status: "practiced",
        attempt_count: 1,
        correct_count: 1,
        practice_question_count: 3,
      }),
      readingProgress: [{
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        chunkId: "ds_k0002",
        paragraphIndex: 3,
        sourceExpanded: true,
        updatedAt: "2026-08-12T07:30:00.000Z",
      }],
      completedTaskIds: ["task_ds_read", "task_extra_3", "task_extra_4", "task_extra_5"],
      completedAssignments: ["task_ds_read", "task_extra_3", "task_extra_4", "task_extra_5"].map((taskId) => ({
        taskId,
        taskType: taskId === "task_ds_read" ? "course_reading" as const : "choice_practice" as const,
        courseId: "course_408_ds" as const,
        conceptId: "ds_c01",
        completedAt: "2026-08-12T07:45:00.000Z",
      })),
    }));

    expect(result.current_task.task_id).not.toBe("task_extra_3");
    expect(result.current_task.concept_id).not.toBe("ds_c01");
  });

  it("starts a new fallback round after every course fallback has been completed", () => {
    const planTaskIds = onboarding().plan?.tasks.map((task) => task.task_id) ?? [];
    const completedFallbackIds = resources.map(
      (resource) => `live_course_${resource.courseId}`,
    );
    const completedTaskIds = [...planTaskIds, ...completedFallbackIds];

    const result = buildStudentLearningOrchestration(input({
      completedTaskIds,
      completedAssignments: completedTaskIds.map((taskId) => ({
        taskId,
        taskType: "course_reading" as const,
        courseId: taskId.includes("course_408_co")
          ? "course_408_co" as const
          : taskId.includes("course_408_os")
            ? "course_408_os" as const
            : taskId.includes("course_408_cn")
              ? "course_408_cn" as const
              : "course_408_ds" as const,
        conceptId: null,
        completedAt: "2026-08-12T07:45:00.000Z",
      })),
    }));

    expect(completedTaskIds).not.toContain(result.current_task.task_id);
    expect(result.current_task.task_id).toMatch(/^live_course_course_408_\w+_round_2$/u);
  });

  it("uses course-wide training when a read concept has no reliable linked question", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "reading", practice_question_count: 0 }),
      readingProgress: [{
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        chunkId: "ds_k0002",
        paragraphIndex: 3,
        sourceExpanded: true,
        updatedAt: "2026-08-12T07:30:00.000Z",
      }],
    }));

    expect(result.current_task).toMatchObject({
      task_type: "choice_practice",
      practice_question_count: 0,
      concept_id: null,
      concept_title: null,
    });
    expect(result.current_task.href).toBe("/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84");
    expect(result.current_task.reason).toContain("暂时没有对应练习");
    const current = result.challenge_journey.nodes.find((node) => (
      node.node_id === result.challenge_journey.current_node_id
    ));
    expect(current).toMatchObject({
      kind: "choice_practice",
      concept_id: null,
      href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84",
    });
  });

  it("summarizes recent profile changes without exposing internal evidence references", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "needs_review", attempt_count: 1, incorrect_count: 1, mistake_count: 1 }),
      mistakes: [mistake()],
      readingProgress: [{
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        chunkId: "ds_private_chunk_001",
        paragraphIndex: 2,
        sourceExpanded: false,
        updatedAt: "2026-08-12T06:30:00.000Z",
      }],
      practiceAttempts: [{
        attemptId: "attempt_private_001",
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        outcome: "incorrect",
        submittedAt: "2026-08-12T07:00:00.000Z",
      }],
    }));

    expect(result.challenge_journey.profile_updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mistake", course_title: "数据结构" }),
      expect.objectContaining({ kind: "practice", course_title: "数据结构" }),
    ]));
    expect(JSON.stringify(result.challenge_journey.profile_updates))
      .not.toMatch(/attempt_private|ds_private_chunk|evidence_refs|确定性/iu);
  });

  it("keeps the initial self-report basis when no objective evidence exists", () => {
    const result = buildStudentLearningOrchestration(input());

    expect(result.evidence_summary).toMatchObject({
      basis: "initial_plan",
      confidence: "low",
      objective_evidence_count: 0,
    });
    expect(result.current_task).toMatchObject({ source: "initial_plan", task_id: "task_ds_read" });
  });

  it("keeps visible task and progress copy free of implementation terminology", () => {
    const starting = buildStudentLearningOrchestration(input({
      onboarding: { ...onboarding(), plan: null },
    }));
    const practice = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "reading", practice_question_count: 3 }),
      readingProgress: [{
        courseId: "course_408_ds",
        conceptId: "ds_c01",
        chunkId: "ds_k0002",
        paragraphIndex: 3,
        sourceExpanded: true,
        updatedAt: "2026-08-12T07:30:00.000Z",
      }],
    }));
    const review = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({ status: "needs_review", attempt_count: 1, incorrect_count: 1, mistake_count: 1 }),
      mistakes: [mistake()],
      recommendations: [{
        mistake_id: "mistake_001",
        course_id: "course_408_ds",
        course_title: "数据结构",
        question_id: "question_001",
        question_number: 1,
        concept_id: "ds_c01",
        concept_title: "算法复杂度",
        priority_score: 86,
        algorithm_version: "evidence_weighted_v1",
        next_review_at: "2026-08-12T07:00:00.000Z",
        due_status: "due",
        evidence_level: "grounded",
        reason_lines: ["已到复习时间", "同一题已错 1 次"],
        evidence_refs: ["mistake:mistake_001"],
        practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c01",
      }],
    }));

    const visibleCopy = [starting, practice, review].flatMap((result) => [
      result.current_task.reason,
      result.current_task.completion_criteria,
      ...result.course_priorities.map((course) => course.rationale),
      ...result.challenge_journey.profile_updates.flatMap((update) => [update.title, update.detail]),
    ]).join("\n");

    expect(visibleCopy).not.toMatch(/确定性|客观学习证据|个人学习证据|精准证据|服务端|工作流|AI/u);
  });

  it("does not reward a fully covered high-accuracy course merely for having more activity", () => {
    const result = buildStudentLearningOrchestration(input({
      learningRecord: learningRecord({
        status: "practiced",
        attempt_count: 10,
        correct_count: 10,
        incorrect_count: 0,
        practice_question_count: 3,
      }),
    }));

    expect(result.course_priorities[0]).toMatchObject({
      course_id: "course_408_co",
      started_concept_count: 0,
      practice_attempt_count: 0,
    });
    expect(result.course_priorities.find((course) => course.course_id === "course_408_ds")?.rank)
      .toBeGreaterThan(1);
  });

  it("keeps an activated task stable when new evidence would otherwise reorder the queue", () => {
    const result = buildStudentLearningOrchestration(input({
      activeAssignment: {
        taskId: "live_read_co_c01",
        taskType: "course_reading",
        courseId: "course_408_co",
        conceptId: "co_c01",
        mistakeId: null,
        activatedAt: "2026-08-12T07:00:00.000Z",
      },
      learningRecord: learningRecord({ status: "reading" }),
      readingProgress: [],
    }));

    expect(result.current_task).toMatchObject({
      task_id: "live_read_co_c01",
      task_type: "course_reading",
      course_id: "course_408_co",
      concept_id: "co_c01",
    });
  });
});
