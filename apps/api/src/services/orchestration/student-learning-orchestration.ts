import {
  ONBOARDING_COURSE_IDS,
  studentLearningOrchestrationSchema,
  type LearningConceptProgress,
  type LearningRecord,
  type MistakeRecommendation,
  type OnboardingCourseId,
  type OnboardingLearningTask,
  type OnboardingState,
  type PracticeMistakeRecord,
  type StudentLearningCoursePriority,
  type StudentLearningChallengeNode,
  type StudentLearningOrchestration,
  type StudentLearningOrchestrationTask,
  type StudentLearningPlanTaskProgress,
  type StudentLearningProfileUpdate,
} from "@xuetu/contracts";

export interface LearningOrchestrationReadingProgress {
  courseId: OnboardingCourseId;
  conceptId: string;
  chunkId: string;
  paragraphIndex: number;
  sourceExpanded: boolean;
  updatedAt: string;
}

export interface LearningOrchestrationPracticeAttempt {
  attemptId: string;
  courseId: OnboardingCourseId;
  conceptId: string | null;
  outcome: "correct" | "incorrect" | "pending_review";
  submittedAt: string;
}

export interface LearningOrchestrationCourseResource {
  courseId: OnboardingCourseId;
  courseTitle: string;
  courseSlug: string;
  subject: string;
}

export interface LearningOrchestrationActiveAssignment {
  taskId: string;
  taskType: StudentLearningOrchestrationTask["task_type"];
  courseId: OnboardingCourseId;
  conceptId: string | null;
  mistakeId: string | null;
  activatedAt: string;
}

export interface LearningOrchestrationPendingProbe {
  probeSessionId: string;
  status: "offered" | "started";
  courseId: OnboardingCourseId;
  conceptId: string;
  conceptTitle: string;
  sourceAttemptId: string;
  offeredAt: string;
}

export interface LearningOrchestrationCompletedAssignment {
  taskId: string;
  taskType: StudentLearningOrchestrationTask["task_type"];
  courseId: OnboardingCourseId;
  conceptId: string | null;
  completedAt: string;
  completionEvidenceRefs?: readonly string[];
}

export interface LearningOrchestrationInput {
  onboarding: OnboardingState;
  learningRecord: LearningRecord;
  mistakes: PracticeMistakeRecord[];
  recommendations?: readonly MistakeRecommendation[];
  readingProgress: LearningOrchestrationReadingProgress[];
  practiceAttempts?: LearningOrchestrationPracticeAttempt[];
  courseResources: LearningOrchestrationCourseResource[];
  completedTaskIds?: readonly string[];
  completedAssignments?: readonly LearningOrchestrationCompletedAssignment[];
  activeAssignment?: LearningOrchestrationActiveAssignment | null;
  pendingProbe?: LearningOrchestrationPendingProbe | null;
  now: Date;
}

interface ConceptContext {
  courseId: OnboardingCourseId;
  courseTitle: string;
  resource: LearningOrchestrationCourseResource;
  concept: LearningConceptProgress;
}

const PRIORITY_WEIGHT = { focus: 3, strengthen: 2, maintain: 1 } as const;

function isOnboardingCourseId(courseId: string): courseId is OnboardingCourseId {
  return ONBOARDING_COURSE_IDS.includes(courseId as OnboardingCourseId);
}

function practiceHref(subject: string, conceptId: string | null, questionCount: number) {
  const base = `/student/practice?subject=${encodeURIComponent(subject)}`;
  return conceptId && questionCount > 0
    ? `${base}&concept_id=${encodeURIComponent(conceptId)}`
    : base;
}

function courseHref(resource: LearningOrchestrationCourseResource) {
  return `/student/courses/${resource.courseSlug}`;
}

function mistakeReviewTaskId(mistakeId: string, nextReviewAt: string) {
  return `review_${mistakeId}_${Date.parse(nextReviewAt)}`;
}

function findConcept(
  record: LearningRecord,
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
  conceptId: string | null,
): ConceptContext | null {
  if (!conceptId) return null;
  for (const course of record.courses) {
    if (!ONBOARDING_COURSE_IDS.includes(course.course_id as OnboardingCourseId)) continue;
    const concept = course.concepts.find((item) => item.concept_id === conceptId);
    const resource = resourceByCourse.get(course.course_id as OnboardingCourseId);
    if (concept && resource) {
      return {
        courseId: course.course_id as OnboardingCourseId,
        courseTitle: course.title,
        resource,
        concept,
      };
    }
  }
  return null;
}

function buildPlanProgress(input: LearningOrchestrationInput) {
  const completedTaskIds = new Set(input.completedTaskIds ?? []);
  const completedAssignments = new Map(
    (input.completedAssignments ?? []).map((assignment) => [assignment.taskId, assignment]),
  );
  const tasks: StudentLearningPlanTaskProgress[] = (input.onboarding.plan?.tasks ?? []).map((task) => {
    const assignment = completedAssignments.get(task.task_id);
    const complete = task.status === "completed" || completedTaskIds.has(task.task_id);
    return {
      task_id: task.task_id,
      day_index: task.day_index,
      task_date: task.task_date,
      course_id: task.course_id,
      course_title: task.course_title,
      concept_id: task.concept_id,
      concept_title: task.concept_title,
      task_type: task.task_type,
      title: task.title,
      estimated_minutes: task.estimated_minutes,
      href: task.href,
      status: complete ? "completed" : "pending",
      completion_evidence_refs: complete
        ? [...(assignment?.completionEvidenceRefs ?? task.evidence_refs)]
        : [],
    };
  });
  const completed = tasks.filter((task) => task.status === "completed").length;
  return {
    plan_id: input.onboarding.plan?.plan_id ?? null,
    completed_task_count: completed,
    total_task_count: tasks.length,
    completion_percent: tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100),
    tasks,
  };
}

function mistakeTask(
  mistake: PracticeMistakeRecord,
  resource: LearningOrchestrationCourseResource,
  concept: LearningConceptProgress | null,
  dailyMinutes: number,
  taskId = `live_${mistake.mistake_id}`,
): StudentLearningOrchestrationTask {
  const conceptLabel = mistake.concept_title ?? "本题相关知识点";
  return {
    task_id: taskId,
    source: "mistake",
    task_type: "mistake_review",
    course_id: resource.courseId,
    course_title: resource.courseTitle,
    concept_id: mistake.concept_id,
    concept_title: mistake.concept_title,
    mistake_id: mistake.mistake_id,
    probe_session_id: null,
    title: `复习：${conceptLabel}`,
    reason: `这道选择题累计答错 ${mistake.wrong_count} 次，先处理未完成的错题复习。`,
    completion_criteria: "完成错题重练并在确认掌握后标记为已掌握。",
    estimated_minutes: Math.min(dailyMinutes, 20),
    href: `/student/mistakes?course_id=${encodeURIComponent(resource.courseId)}${
      mistake.concept_id ? `&concept_id=${encodeURIComponent(mistake.concept_id)}` : ""
    }`,
    practice_question_count: concept?.practice_question_count ?? 0,
    evidence_refs: [
      `mistake:${mistake.mistake_id}`,
      `evaluation:${mistake.last_incorrect_evaluation_id}`,
    ],
  };
}

function recommendedMistakeTask(
  recommendation: MistakeRecommendation,
  resource: LearningOrchestrationCourseResource,
  concept: LearningConceptProgress | null,
  dailyMinutes: number,
): StudentLearningOrchestrationTask {
  return {
    task_id: mistakeReviewTaskId(recommendation.mistake_id, recommendation.next_review_at),
    source: "mistake",
    task_type: "mistake_review",
    course_id: resource.courseId,
    course_title: resource.courseTitle,
    concept_id: recommendation.concept_id,
    concept_title: recommendation.concept_title,
    mistake_id: recommendation.mistake_id,
    probe_session_id: null,
    title: `优先复习：${recommendation.concept_title}`,
    reason: recommendation.reason_lines.slice(0, 2).join("；"),
    completion_criteria: "完成这道错题重练；后续答对关联题后更新掌握状态。",
    estimated_minutes: Math.min(dailyMinutes, 20),
    href: recommendation.practice_href,
    practice_question_count: concept?.practice_question_count ?? 0,
    evidence_refs: recommendation.evidence_refs,
  };
}

function readingTask(
  progress: LearningOrchestrationReadingProgress,
  context: ConceptContext,
  dailyMinutes: number,
  taskId?: string,
): StudentLearningOrchestrationTask {
  const questionCount = context.concept.practice_question_count ?? 0;
  if (!progress.sourceExpanded) {
    return {
       task_id: taskId ?? `live_read_${context.concept.concept_id}`,
      source: "reading_progress",
      task_type: "course_reading",
      course_id: context.courseId,
      course_title: context.courseTitle,
       concept_id: context.concept.concept_id,
       concept_title: context.concept.title,
       mistake_id: null,
       probe_session_id: null,
      title: `继续阅读：${context.concept.title}`,
      reason: `你上次读到第 ${progress.paragraphIndex + 1} 段，先接着完成当前知识点。`,
      completion_criteria: "展开并完成该知识点的课程化讲解阅读。",
      estimated_minutes: Math.min(dailyMinutes, 25),
      href: courseHref(context.resource),
      practice_question_count: questionCount,
      evidence_refs: [`reading:${context.courseId}:${context.concept.concept_id}`],
    };
  }
  const hasPrecisePractice = questionCount > 0;
  return {
    task_id: taskId ?? `live_practice_${context.concept.concept_id}`,
    source: "reading_progress",
    task_type: "choice_practice",
    course_id: context.courseId,
    course_title: context.courseTitle,
    concept_id: hasPrecisePractice ? context.concept.concept_id : null,
    concept_title: hasPrecisePractice ? context.concept.title : null,
    mistake_id: null,
    probe_session_id: null,
    title: hasPrecisePractice
      ? `练习：${context.concept.title}`
      : `完成一次${context.courseTitle}综合训练`,
    reason: hasPrecisePractice
      ? `已完成“${context.concept.title}”阅读，接着做一道相关 408 题检查理解。`
      : `“${context.concept.title}”暂时没有对应练习，先完成一次${context.courseTitle}综合训练。`,
    completion_criteria: "完成至少一道选择题并查看结果。",
    estimated_minutes: Math.min(dailyMinutes, 30),
    href: practiceHref(context.resource.subject, context.concept.concept_id, questionCount),
    practice_question_count: questionCount,
    evidence_refs: [
      `reading:${context.courseId}:${context.concept.concept_id}`,
      hasPrecisePractice ? `question_links:${context.concept.concept_id}:${questionCount}` : `course_fallback:${context.courseId}`,
    ],
  };
}

function initialPlanTask(
  task: OnboardingLearningTask,
  context: ConceptContext | null,
  resource: LearningOrchestrationCourseResource,
): StudentLearningOrchestrationTask {
  const questionCount = context?.concept.practice_question_count ?? 0;
  const precisePractice = task.task_type === "choice_practice" && questionCount > 0;
  const href = task.task_type === "choice_practice"
    ? practiceHref(resource.subject, task.concept_id, questionCount)
    : task.href;
  return {
    task_id: task.task_id,
    source: "initial_plan",
    task_type: task.task_type,
    course_id: task.course_id,
    course_title: task.course_title,
    concept_id: task.task_type === "choice_practice" && !precisePractice ? null : task.concept_id,
    concept_title: task.task_type === "choice_practice" && !precisePractice ? null : task.concept_title,
    mistake_id: null,
    probe_session_id: null,
    title: task.task_type === "choice_practice" && !precisePractice
      ? `完成一次${task.course_title}综合训练`
      : task.title,
    reason: task.task_type === "choice_practice" && !precisePractice
      ? `${task.concept_title ?? "当前知识点"}暂时没有对应练习，先完成一次${task.course_title}综合训练。`
      : task.reason,
    completion_criteria: task.completion_criteria,
    estimated_minutes: task.estimated_minutes,
    href,
    practice_question_count: questionCount,
    evidence_refs: task.evidence_refs,
  };
}

function fallbackTask(
  priority: StudentLearningCoursePriority,
  resource: LearningOrchestrationCourseResource,
  dailyMinutes: number,
  taskId = `live_course_${priority.course_id}`,
): StudentLearningOrchestrationTask {
  return {
    task_id: taskId,
    source: "course_fallback",
    task_type: "course_reading",
    course_id: priority.course_id,
    course_title: priority.course_title,
    concept_id: null,
    concept_title: null,
    mistake_id: null,
    probe_session_id: null,
    title: `进入${priority.course_title}继续学习`,
    reason: "当前没有待完成的复习或练习任务，按四门课进度继续学习。",
    completion_criteria: "进入课程知识地图并开始一个核心知识点。",
    estimated_minutes: Math.min(dailyMinutes, 25),
    href: courseHref(resource),
    practice_question_count: 0,
    evidence_refs: [`course_structure:${priority.course_id}`],
  };
}

function fallbackTaskForAvailablePriority(
  priorities: readonly StudentLearningCoursePriority[],
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
  completedTaskIds: ReadonlySet<string>,
  dailyMinutes: number,
) {
  const completionCount = (courseId: OnboardingCourseId) => {
    const baseId = `live_course_${courseId}`;
    let count = completedTaskIds.has(baseId) ? 1 : 0;
    for (const taskId of completedTaskIds) {
      if (taskId.startsWith(`${baseId}_round_`)) count += 1;
    }
    return count;
  };
  const fewestRounds = Math.min(...priorities.map((priority) => (
    completionCount(priority.course_id)
  )));
  const candidate = priorities.find((priority) => (
    completionCount(priority.course_id) === fewestRounds
  ))!;
  const nextRound = fewestRounds + 1;
  const taskId = nextRound === 1
    ? `live_course_${candidate.course_id}`
    : `live_course_${candidate.course_id}_round_${nextRound}`;
  return fallbackTask(
    candidate,
    resourceByCourse.get(candidate.course_id)!,
    dailyMinutes,
    taskId,
  );
}

function pendingProbeTask(
  probe: LearningOrchestrationPendingProbe,
  resource: LearningOrchestrationCourseResource,
  dailyMinutes: number,
): StudentLearningOrchestrationTask {
  return {
    task_id: `probe_${probe.probeSessionId}`,
    source: "probe",
    task_type: "choice_practice",
    course_id: probe.courseId,
    course_title: resource.courseTitle,
    concept_id: probe.conceptId,
    concept_title: probe.conceptTitle,
    mistake_id: null,
    probe_session_id: probe.probeSessionId,
    title: "确认一次相关知识点",
    reason: probe.status === "started"
      ? `你已经开始“${probe.conceptTitle}”的验证，回来继续完成这道对照题。`
      : `你之前的一次错答留下了待确认信号，用另一道题再看一次“${probe.conceptTitle}”。`,
    completion_criteria: "完成对照题并查看结果。",
    estimated_minutes: Math.min(dailyMinutes, 15),
    href: `/student/practice?subject=${encodeURIComponent(resource.subject)}&concept_id=${encodeURIComponent(probe.conceptId)}&probe_session_id=${encodeURIComponent(probe.probeSessionId)}`,
    practice_question_count: 1,
    evidence_refs: [`probe:${probe.probeSessionId}`, `attempt:${probe.sourceAttemptId}`],
  };
}

function activeAssignmentTask(
  assignment: LearningOrchestrationActiveAssignment,
  input: LearningOrchestrationInput,
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
  dailyMinutes: number,
): StudentLearningOrchestrationTask | null {
  const resource = resourceByCourse.get(assignment.courseId);
  if (!resource) return null;

  if (assignment.taskType === "mistake_review" && assignment.mistakeId) {
    const mistake = input.mistakes.find((item) => item.mistake_id === assignment.mistakeId);
    if (!mistake) return null;
    const context = findConcept(input.learningRecord, resourceByCourse, mistake.concept_id);
    return mistakeTask(mistake, resource, context?.concept ?? null, dailyMinutes, assignment.taskId);
  }

  const planTask = input.onboarding.plan?.tasks.find((item) => item.task_id === assignment.taskId);
  if (planTask) {
    return initialPlanTask(
      planTask,
      findConcept(input.learningRecord, resourceByCourse, planTask.concept_id),
      resource,
    );
  }

  if (assignment.taskType === "course_reading" && !assignment.conceptId) {
    const priority = buildCoursePriorities(input, resourceByCourse).find((item) => item.course_id === assignment.courseId);
    return priority ? fallbackTask(priority, resource, dailyMinutes, assignment.taskId) : null;
  }

  if (assignment.taskType === "choice_practice" && !assignment.conceptId) {
    return {
      task_id: assignment.taskId,
      source: "reading_progress",
      task_type: "choice_practice",
      course_id: assignment.courseId,
      course_title: resource.courseTitle,
       concept_id: null,
       concept_title: null,
       mistake_id: null,
       probe_session_id: null,
      title: `完成一次${resource.courseTitle}综合训练`,
      reason: "当前知识点暂时没有对应练习，先完成一次课程综合训练。",
      completion_criteria: "完成至少一道选择题并查看结果。",
      estimated_minutes: Math.min(dailyMinutes, 30),
      href: practiceHref(resource.subject, null, 0),
      practice_question_count: 0,
      evidence_refs: [`course_fallback:${assignment.courseId}`],
    };
  }

  const context = findConcept(input.learningRecord, resourceByCourse, assignment.conceptId);
  if (!context) return null;
  const progress = input.readingProgress.find((item) => (
    item.courseId === assignment.courseId && item.conceptId === assignment.conceptId
  ));
  if (assignment.taskType === "course_reading") {
    return readingTask(progress ?? {
      courseId: assignment.courseId,
      conceptId: assignment.conceptId!,
      chunkId: `pending:${assignment.conceptId}`,
      paragraphIndex: 0,
      sourceExpanded: false,
      updatedAt: assignment.activatedAt,
    }, context, dailyMinutes, assignment.taskId);
  }
  if (assignment.taskType === "choice_practice") {
    const questionCount = context.concept.practice_question_count ?? 0;
    return {
      task_id: assignment.taskId,
      source: "reading_progress",
      task_type: "choice_practice",
      course_id: assignment.courseId,
      course_title: context.courseTitle,
       concept_id: assignment.conceptId,
       concept_title: context.concept.title,
       mistake_id: null,
       probe_session_id: null,
      title: questionCount > 0 ? `练习：${context.concept.title}` : `完成一次${context.courseTitle}综合训练`,
      reason: questionCount > 0
        ? `已完成“${context.concept.title}”阅读，接着做一道相关 408 题检查理解。`
        : `“${context.concept.title}”暂时没有对应练习，先完成一次${context.courseTitle}综合训练。`,
      completion_criteria: "完成至少一道选择题并查看结果。",
      estimated_minutes: Math.min(dailyMinutes, 30),
      href: practiceHref(resource.subject, assignment.conceptId, questionCount),
      practice_question_count: questionCount,
      evidence_refs: [
        `reading:${assignment.courseId}:${assignment.conceptId}`,
        questionCount > 0 ? `question_links:${assignment.conceptId}:${questionCount}` : `course_fallback:${assignment.courseId}`,
      ],
    };
  }
  return null;
}

function buildCoursePriorities(
  input: LearningOrchestrationInput,
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
): StudentLearningCoursePriority[] {
  const initialOrder = new Map(
    (input.onboarding.profile?.priority_courses ?? []).map((course, index) => [course.course_id, index]),
  );
  const initialPriority = new Map(
    (input.onboarding.profile?.priority_courses ?? []).map((course) => [course.course_id, course.priority]),
  );
  const rows = ONBOARDING_COURSE_IDS.map((courseId, fixedIndex) => {
    const course = input.learningRecord.courses.find((item) => item.course_id === courseId);
    const resource = resourceByCourse.get(courseId)!;
    const started = course?.started_concept_count ?? 0;
    const attempts = course?.practice_attempt_count ?? 0;
    const incorrect = course?.incorrect_count ?? 0;
    const needsReview = course?.needs_review_count ?? 0;
    const conceptCount = course?.concept_count ?? 0;
    const unstarted = Math.max(0, conceptCount - started);
    const coverageGap = conceptCount > 0 ? unstarted / conceptCount : 0;
    const errorRate = attempts > 0 ? incorrect / attempts : 0;
    const selfPriority = initialPriority.get(courseId) ?? (fixedIndex === 0 ? "focus" : fixedIndex === 1 ? "strengthen" : "maintain");
    const weaknessScore = needsReview * 10_000
      + Math.round(errorRate * 1_000)
      + Math.round(coverageGap * 500);
    return {
      courseId,
      fixedIndex,
      initialIndex: initialOrder.get(courseId) ?? fixedIndex,
      selfPriority,
      weaknessScore,
      course,
      resource,
    };
  });
  rows.sort((left, right) => (
    right.weaknessScore - left.weaknessScore
    || PRIORITY_WEIGHT[right.selfPriority] - PRIORITY_WEIGHT[left.selfPriority]
    || left.initialIndex - right.initialIndex
    || left.fixedIndex - right.fixedIndex
  ));
  return rows.map((row, index) => {
    const started = row.course?.started_concept_count ?? 0;
    const attempts = row.course?.practice_attempt_count ?? 0;
    const incorrect = row.course?.incorrect_count ?? 0;
    const needsReview = row.course?.needs_review_count ?? 0;
    const conceptCount = row.course?.concept_count ?? 0;
    const unstarted = Math.max(0, conceptCount - started);
    const hasLive = started > 0 || attempts > 0 || needsReview > 0;
    return {
      rank: index + 1,
      course_id: row.courseId,
      course_title: row.resource.courseTitle,
      priority: index === 0 ? "focus" : index === 1 ? "strengthen" : "maintain",
      evidence_level: attempts >= 3 || needsReview > 0
        ? "grounded"
        : hasLive
          ? "limited"
          : "self_report_only",
      rationale: needsReview > 0
        ? `存在 ${needsReview} 个待复习知识点，优先完成错题闭环。`
        : incorrect > 0
          ? `${attempts} 次真实作答中有 ${incorrect} 次错误，需要优先补强。`
          : unstarted > 0
            ? `还有 ${unstarted}/${conceptCount} 个课程化知识点尚未开始。`
            : attempts > 0
              ? `当前 ${attempts} 次真实作答未显示待复习信号，优先级让给薄弱或未覆盖课程。`
              : "这门课还没有阅读或作答记录，暂按首次自评安排顺序。",
      started_concept_count: started,
      concept_count: conceptCount,
      practice_attempt_count: attempts,
      needs_review_count: needsReview,
      href: courseHref(row.resource),
    };
  });
}

function latestReadingTask(
  input: LearningOrchestrationInput,
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
  dailyMinutes: number,
) {
  const sorted = [...input.readingProgress].sort((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  ));
  for (const progress of sorted) {
    const context = findConcept(input.learningRecord, resourceByCourse, progress.conceptId);
    if (!context || context.concept.attempt_count > 0) continue;
    if (progress.sourceExpanded && (context.concept.practice_question_count ?? 0) === 0) {
      const completedFallback = (input.practiceAttempts ?? []).some((attempt) => (
        attempt.courseId === progress.courseId
        && attempt.conceptId === null
        && attempt.outcome !== "pending_review"
        && Date.parse(attempt.submittedAt) >= Date.parse(progress.updatedAt)
      ));
      if (completedFallback) continue;
    }
    return readingTask(progress, context, dailyMinutes);
  }
  return null;
}

function challengeKind(taskType: StudentLearningOrchestrationTask["task_type"]): StudentLearningChallengeNode["kind"] {
  if (taskType === "choice_practice") return "choice_practice";
  if (taskType === "mistake_review") return "mistake_review";
  return "course_reading";
}

function challengeNodeFromTask(
  task: StudentLearningOrchestrationTask,
  status: StudentLearningChallengeNode["status"],
): StudentLearningChallengeNode {
  const isCourseWidePractice = task.task_type === "choice_practice" && task.practice_question_count === 0;
  return {
    node_id: `journey_${task.task_id}`,
    task_id: task.task_id,
    kind: challengeKind(task.task_type),
    status,
    course_id: task.course_id,
    course_title: task.course_title,
    concept_id: isCourseWidePractice ? null : task.concept_id,
    title: task.title,
    href: task.href,
  };
}

function completedAssignmentNode(
  assignment: LearningOrchestrationCompletedAssignment,
  input: LearningOrchestrationInput,
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
): StudentLearningChallengeNode | null {
  const resource = resourceByCourse.get(assignment.courseId);
  if (!resource) return null;
  const planTask = input.onboarding.plan?.tasks.find((task) => task.task_id === assignment.taskId);
  if (planTask) {
    const task = initialPlanTask(
      planTask,
      findConcept(input.learningRecord, resourceByCourse, planTask.concept_id),
      resource,
    );
    return challengeNodeFromTask(task, "completed");
  }

  const context = findConcept(input.learningRecord, resourceByCourse, assignment.conceptId);
  const questionCount = context?.concept.practice_question_count ?? 0;
  const courseWidePractice = assignment.taskType === "choice_practice" && questionCount === 0;
  const conceptTitle = context?.concept.title ?? null;
  const href = assignment.taskType === "choice_practice"
    ? practiceHref(resource.subject, assignment.conceptId, questionCount)
    : assignment.taskType === "mistake_review"
      ? `/student/mistakes?course_id=${encodeURIComponent(assignment.courseId)}${
          assignment.conceptId ? `&concept_id=${encodeURIComponent(assignment.conceptId)}` : ""
        }`
      : courseHref(resource);
  const title = assignment.taskType === "choice_practice"
    ? courseWidePractice
      ? `已完成${resource.courseTitle}综合训练`
      : `已练习：${conceptTitle ?? resource.courseTitle}`
    : assignment.taskType === "mistake_review"
      ? `已完成错题返场：${conceptTitle ?? resource.courseTitle}`
      : `已学习：${conceptTitle ?? resource.courseTitle}`;
  return {
    node_id: `journey_${assignment.taskId}`,
    task_id: assignment.taskId,
    kind: challengeKind(assignment.taskType),
    status: "completed",
    course_id: assignment.courseId,
    course_title: resource.courseTitle,
    concept_id: courseWidePractice ? null : assignment.conceptId,
    title,
    href,
  };
}

function chinaCalendarDate(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function buildRecentChallengeActivity(input: LearningOrchestrationInput) {
  const currentDate = chinaCalendarDate(input.now);
  const currentDayStart = new Date(`${currentDate}T00:00:00+08:00`);
  const completedDates = new Set((input.completedAssignments ?? []).map((assignment) => (
    chinaCalendarDate(assignment.completedAt)
  )));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(currentDayStart.getTime() - ((6 - index) * 24 * 60 * 60 * 1_000));
    const date = chinaCalendarDate(day);
    return { date, completed: completedDates.has(date) };
  });
  return {
    completed_day_count: days.filter((day) => day.completed).length,
    days,
  };
}

interface TimedProfileUpdate extends StudentLearningProfileUpdate {
  sort_at: number;
}

function buildProfileUpdates(
  input: LearningOrchestrationInput,
  currentTask: StudentLearningOrchestrationTask,
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
): StudentLearningProfileUpdate[] {
  const updates: Omit<TimedProfileUpdate, "update_id">[] = [];
  for (const assignment of input.completedAssignments ?? []) {
    const resource = resourceByCourse.get(assignment.courseId);
    if (!resource) continue;
    updates.push({
      course_id: assignment.courseId,
      course_title: resource.courseTitle,
      kind: "task_completion",
      occurred_at: assignment.completedAt,
      title: `完成了一项${resource.courseTitle}学习任务`,
      detail: "学习进度已更新，可以从下一项继续。",
      sort_at: Date.parse(assignment.completedAt),
    });
  }
  for (const item of input.mistakes) {
    if (!isOnboardingCourseId(item.course_id)) continue;
    updates.push({
      course_id: item.course_id,
      course_title: item.course_title,
      kind: "mistake",
      occurred_at: item.updated_at,
      title: item.status === "mastered"
        ? `${item.concept_title ?? "相关知识点"}已完成复习`
        : `${item.concept_title ?? "相关知识点"}进入待复习队列`,
      detail: item.status === "mastered"
        ? "已完成规定次数的正确重练，复习状态已更新。"
        : `选择题累计答错 ${item.wrong_count} 次，因此提高了该知识点的复习优先级。`,
      sort_at: Date.parse(item.updated_at),
    });
  }
  for (const attempt of input.practiceAttempts ?? []) {
    const resource = resourceByCourse.get(attempt.courseId);
    if (!resource) continue;
    updates.push({
      course_id: attempt.courseId,
      course_title: resource.courseTitle,
      kind: "practice",
      occurred_at: attempt.submittedAt,
      title: attempt.outcome === "correct"
        ? `${resource.courseTitle}新增一次正确作答`
        : attempt.outcome === "incorrect"
          ? `${resource.courseTitle}新增一个复习信号`
          : `${resource.courseTitle}新增一项待审核作答`,
      detail: attempt.outcome === "correct"
        ? "本次作答正确，后续任务会继续安排巩固。"
        : attempt.outcome === "incorrect"
          ? "本次作答错误，相关复习任务会优先安排。"
          : "本题需要教师审核，审核前不会更新掌握状态。",
      sort_at: Date.parse(attempt.submittedAt),
    });
  }
  for (const progress of input.readingProgress) {
    const resource = resourceByCourse.get(progress.courseId);
    const context = findConcept(input.learningRecord, resourceByCourse, progress.conceptId);
    if (!resource) continue;
    updates.push({
      course_id: progress.courseId,
      course_title: resource.courseTitle,
      kind: "reading",
      occurred_at: progress.updatedAt,
      title: `继续阅读：${context?.concept.title ?? resource.courseTitle}`,
      detail: `已保存到第 ${progress.paragraphIndex + 1} 段，下一次可从该位置继续。`,
      sort_at: Date.parse(progress.updatedAt),
    });
  }

  const recent = updates
    .sort((left, right) => right.sort_at - left.sort_at)
    .slice(0, 3)
    .map(({ sort_at: _sortAt, ...update }, index) => ({
      ...update,
      update_id: `profile_${update.kind}_${index + 1}`,
    }));
  if (recent.length > 0) return recent;
  return [{
    update_id: "profile_starting_point_1",
    course_id: currentTask.course_id,
    course_title: currentTask.course_title,
    kind: "starting_point",
    occurred_at: null,
    title: "个人学习记录正在形成",
    detail: "当前先按备考设置安排起步任务；完成阅读或作答后，学习画像会随进度更新。",
  }];
}

function buildChallengeJourney(
  input: LearningOrchestrationInput,
  currentTask: StudentLearningOrchestrationTask,
  planProgress: ReturnType<typeof buildPlanProgress>,
  coursePriorities: readonly StudentLearningCoursePriority[],
  resourceByCourse: Map<OnboardingCourseId, LearningOrchestrationCourseResource>,
  currentReviewDue: boolean,
) {
  const currentNode = challengeNodeFromTask(
    currentTask,
    input.activeAssignment?.taskId === currentTask.task_id
      || (currentTask.source === "probe" && input.pendingProbe?.status === "started")
      ? "in_progress"
      : currentReviewDue
        ? "review_due"
        : "recommended",
  );
  const completedNodes = [...(input.completedAssignments ?? [])]
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
    .flatMap((assignment) => {
      if (assignment.taskId === currentTask.task_id) return [];
      const node = completedAssignmentNode(assignment, input, resourceByCourse);
      return node ? [node] : [];
    })
    .slice(0, 1);
  const usedTaskIds = new Set([
    currentTask.task_id,
    ...completedNodes.flatMap((node) => node.task_id ? [node.task_id] : []),
  ]);
  const availableNodes: StudentLearningChallengeNode[] = [];
  for (const progressTask of planProgress.tasks) {
    if (availableNodes.length >= 3 || progressTask.status !== "pending" || usedTaskIds.has(progressTask.task_id)) continue;
    const sourceTask = input.onboarding.plan?.tasks.find((task) => task.task_id === progressTask.task_id);
    const resource = resourceByCourse.get(progressTask.course_id);
    if (!sourceTask || !resource) continue;
    const task = initialPlanTask(
      sourceTask,
      findConcept(input.learningRecord, resourceByCourse, sourceTask.concept_id),
      resource,
    );
    availableNodes.push(challengeNodeFromTask(task, "available"));
    usedTaskIds.add(task.task_id);
  }
  for (const priority of coursePriorities) {
    if (availableNodes.length >= 3) break;
    const resource = resourceByCourse.get(priority.course_id);
    if (!resource) continue;
    const task = fallbackTask(priority, resource, input.onboarding.goals?.daily_minutes ?? 60);
    if (usedTaskIds.has(task.task_id)) continue;
    availableNodes.push(challengeNodeFromTask(task, "available"));
    usedTaskIds.add(task.task_id);
  }

  return {
    current_stage_label: `${currentTask.course_title} · ${currentTask.concept_title ?? "课程主线"}`,
    current_node_id: currentNode.node_id,
    nodes: [...completedNodes, currentNode, ...availableNodes].slice(0, 5),
    recent_activity: buildRecentChallengeActivity(input),
    profile_updates: buildProfileUpdates(input, currentTask, resourceByCourse),
  };
}

export function buildStudentLearningOrchestration(
  input: LearningOrchestrationInput,
): StudentLearningOrchestration {
  const resourceByCourse = new Map(input.courseResources.map((resource) => [resource.courseId, resource]));
  if (ONBOARDING_COURSE_IDS.some((courseId) => !resourceByCourse.has(courseId))) {
    throw new Error("Learning orchestration requires all four 408 course resources.");
  }
  const dailyMinutes = input.onboarding.goals?.daily_minutes ?? 60;
  const planProgress = buildPlanProgress(input);
  const completedTaskIds = new Set(input.completedTaskIds ?? []);
  const coursePriorities = buildCoursePriorities(input, resourceByCourse);
  const dueRecommendation = (input.recommendations ?? []).find((recommendation) => (
    recommendation.due_status === "due"
    && ONBOARDING_COURSE_IDS.includes(recommendation.course_id as OnboardingCourseId)
    && !completedTaskIds.has(mistakeReviewTaskId(recommendation.mistake_id, recommendation.next_review_at))
  ));

  let currentTask: StudentLearningOrchestrationTask | null = null;
  if (input.activeAssignment) {
    currentTask = activeAssignmentTask(input.activeAssignment, input, resourceByCourse, dailyMinutes);
  }
  if (
    !currentTask
    && dueRecommendation
  ) {
    const resource = resourceByCourse.get(dueRecommendation.course_id as OnboardingCourseId)!;
    const context = findConcept(input.learningRecord, resourceByCourse, dueRecommendation.concept_id);
    currentTask = recommendedMistakeTask(dueRecommendation, resource, context?.concept ?? null, dailyMinutes);
  }
  if (!currentTask && input.pendingProbe) {
    const resource = resourceByCourse.get(input.pendingProbe.courseId);
    if (resource) currentTask = pendingProbeTask(input.pendingProbe, resource, dailyMinutes);
  }
  currentTask ??= latestReadingTask(input, resourceByCourse, dailyMinutes);

  if (!currentTask && input.onboarding.plan) {
    const progressById = new Map(planProgress.tasks.map((task) => [task.task_id, task]));
    const unfinished = input.onboarding.plan.tasks.find((task) => (
      progressById.get(task.task_id)?.status === "pending" && !completedTaskIds.has(task.task_id)
    ));
    if (unfinished) {
      const resource = resourceByCourse.get(unfinished.course_id)!;
      currentTask = initialPlanTask(
        unfinished,
        findConcept(input.learningRecord, resourceByCourse, unfinished.concept_id),
        resource,
      );
    }
  }
  if (!currentTask) {
    currentTask = fallbackTaskForAvailablePriority(coursePriorities, resourceByCourse, completedTaskIds, dailyMinutes);
  }

  const challengeJourney = buildChallengeJourney(
    input,
    currentTask,
    planProgress,
    coursePriorities,
    resourceByCourse,
    Boolean(
      dueRecommendation
      && currentTask.task_id === mistakeReviewTaskId(
        dueRecommendation.mistake_id,
        dueRecommendation.next_review_at,
      )
    ),
  );

  const practiceAttemptCount = (input.practiceAttempts?.length ?? 0) > 0
    ? input.practiceAttempts!.length
    : input.learningRecord.courses.reduce((sum, course) => sum + course.practice_attempt_count, 0);
  const readingCount = input.readingProgress.length;
  const objectiveCount = readingCount + practiceAttemptCount;
  const needsReviewCount = input.mistakes.filter((mistake) => mistake.status === "needs_review").length;
  const evidenceRefs = [
    ...input.readingProgress.map((item) => `reading:${item.courseId}:${item.conceptId}`),
    ...((input.practiceAttempts ?? []).map((item) => `attempt:${item.attemptId}`)),
  ].slice(0, 30);
  if (practiceAttemptCount > 0 && (input.practiceAttempts?.length ?? 0) === 0) {
    evidenceRefs.push(`attempts:${practiceAttemptCount}`);
  }

  return studentLearningOrchestrationSchema.parse({
    generated_at: input.now.toISOString(),
    source: "deterministic_evidence_rules",
    ai_status: "unavailable",
    ai_status_message: "今日任务由可验证学习证据确定；AI 学伴只提供解释，不修改任务或学习记录。",
    goal_context: input.onboarding.goals
      ? {
          target_exam_year: input.onboarding.goals.target_exam_year,
          preparation_stage: input.onboarding.goals.preparation_stage,
          daily_minutes: input.onboarding.goals.daily_minutes,
          target_school: input.onboarding.goals.target_school ?? null,
          target_score: input.onboarding.goals.target_score ?? null,
        }
      : null,
    evidence_summary: {
      basis: objectiveCount > 0 ? "live_evidence" : input.onboarding.plan ? "initial_plan" : "course_structure",
      confidence: objectiveCount === 0 ? "low" : objectiveCount >= 5 ? "grounded" : "developing",
      objective_evidence_count: objectiveCount,
      subjective_evidence_count: input.onboarding.self_assessments.length,
      reading_progress_count: readingCount,
      practice_attempt_count: practiceAttemptCount,
      needs_review_count: needsReviewCount,
      explanation: objectiveCount === 0
        ? "目前没有阅读或作答记录，系统只按首次学习设置给出起步任务。"
        : `当前判断结合 ${readingCount} 条课程阅读位置与 ${practiceAttemptCount} 次真实作答。`,
      evidence_refs: objectiveCount === 0
        ? input.onboarding.self_assessments.map((item) => `self:${item.course_id}`)
        : evidenceRefs,
    },
    plan_progress: planProgress,
    challenge_journey: challengeJourney,
    current_task: currentTask,
    course_priorities: coursePriorities,
    boundary_note: "当前结果只描述已存储学习证据，不代表分数、排名、录取概率或提分效果。",
  });
}
