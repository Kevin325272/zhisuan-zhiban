import {
  ONBOARDING_COURSE_IDS,
  onboardingInitialProfileSchema,
  onboardingLearningPlanSchema,
  type OnboardingCourseId,
  type OnboardingGoals,
  type OnboardingInitialProfile,
  type OnboardingLearningPlan,
  type OnboardingSelfAssessment,
  type OnboardingSelfAssessmentLevel,
} from "@xuetu/contracts";

export interface OnboardingScreeningEvidence {
  courseId: OnboardingCourseId;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  unsureCount: number;
  skippedCount: number;
  riskConcepts: Array<{
    conceptId: string;
    conceptTitle: string;
    questionId: string;
    practiceQuestionCount?: number;
  }>;
}

export interface OnboardingCourseResource {
  courseId: OnboardingCourseId;
  courseTitle: string;
  subject: string;
  courseHref: string;
  fallbackConcept: {
    conceptId: string;
    conceptTitle: string;
    practiceQuestionCount: number;
  };
}

export interface DeterministicOnboardingInput {
  goals: OnboardingGoals;
  selfAssessments: OnboardingSelfAssessment[];
  resources: OnboardingCourseResource[];
  profileVersion: number;
  planVersion: number;
  now: Date;
  createId: (prefix: string) => string;
  screening?: OnboardingScreeningEvidence[];
}

const SELF_PRIORITY: Record<OnboardingSelfAssessmentLevel, number> = {
  not_started: 5,
  weak: 4,
  average: 3,
  good: 2,
  reinforcing: 1,
};

const SELF_ASSESSMENT_LABELS: Record<OnboardingSelfAssessmentLevel, string> = {
  not_started: "尚未开始",
  weak: "基础较弱",
  average: "有一定基础",
  good: "基础较好",
  reinforcing: "正在强化",
};

const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function chinaCalendarDate(date: Date, daysAfter = 0) {
  const parts = Object.fromEntries(
    CHINA_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const shifted = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + daysAfter,
  ));
  return shifted.toISOString().slice(0, 10);
}

function priorityLabel(index: number): "focus" | "strengthen" | "maintain" {
  if (index === 0) return "focus";
  if (index === 1) return "strengthen";
  return "maintain";
}

function screeningSignal(item: OnboardingScreeningEvidence | undefined) {
  if (!item) return 0;
  if (item.incorrectCount > 0) return 2;
  if (item.unsureCount > 0) return 1;
  return 0;
}

function screeningSignalLabel(item: OnboardingScreeningEvidence | undefined) {
  const signal = screeningSignal(item);
  if (signal === 2) return "observed_gap" as const;
  if (signal === 1) return "needs_evidence" as const;
  return "none" as const;
}

export function buildDeterministicOnboardingResult(
  input: DeterministicOnboardingInput,
): { profile: OnboardingInitialProfile; plan: OnboardingLearningPlan } {
  const resourceByCourse = new Map(input.resources.map((resource) => [resource.courseId, resource]));
  const assessmentByCourse = new Map(input.selfAssessments.map((item) => [item.course_id, item]));
  const screeningByCourse = new Map(input.screening?.map((item) => [item.courseId, item]));
  if (ONBOARDING_COURSE_IDS.some((courseId) => !resourceByCourse.has(courseId) || !assessmentByCourse.has(courseId))) {
    throw new Error("Deterministic onboarding requires all four 408 course resources and self assessments.");
  }

  const ranked = ONBOARDING_COURSE_IDS.map((courseId, fixedIndex) => {
    const resource = resourceByCourse.get(courseId)!;
    const assessment = assessmentByCourse.get(courseId)!;
    const screening = screeningByCourse.get(courseId);
    const signal = screeningSignal(screening);
    const screeningRefs = (screening?.riskConcepts ?? []).map(
      (concept) => `screening:${courseId}:${concept.questionId}`,
    );
    return {
      fixedIndex,
      internalPriority: SELF_PRIORITY[assessment.level],
      screeningPriority: signal,
      resource,
      assessment,
      screening,
      evidenceRefs: [`self:${courseId}`, ...screeningRefs],
    };
  }).sort((left, right) => (
    right.screeningPriority - left.screeningPriority
      || right.internalPriority - left.internalPriority
      || left.fixedIndex - right.fixedIndex
  ));

  const priorityCourses = ranked.map((item, index) => ({
    course_id: item.resource.courseId,
    course_title: item.resource.courseTitle,
    priority: priorityLabel(index),
    self_assessment: item.assessment.level,
    evidence_level: item.screeningPriority > 0 ? "screening_signal" as const : "self_report_only" as const,
    evidence_refs: item.evidenceRefs,
    screening_signal: screeningSignalLabel(item.screening),
    rationale: item.screening?.incorrectCount
      ? `起步筛查中有 ${item.screening.incorrectCount} 道题未答对，先复习已定位的知识点；这不是能力分。`
      : item.screening?.unsureCount
        ? `起步筛查中有 ${item.screening.unsureCount} 道题标记为不确定，先用练习确认理解；不把它当作答错。`
        : `你将本课程标记为“${SELF_ASSESSMENT_LABELS[item.assessment.level]}”，当前按自评安排起步顺序。`,
  }));

  const screeningSummary = input.screening && input.screening.length > 0
    ? {
        status: "completed" as const,
        answered_count: input.screening.reduce((sum, item) => sum + item.answeredCount, 0),
        correct_count: input.screening.reduce((sum, item) => sum + item.correctCount, 0),
        incorrect_count: input.screening.reduce((sum, item) => sum + item.incorrectCount, 0),
        unsure_count: input.screening.reduce((sum, item) => sum + item.unsureCount, 0),
        skipped_count: input.screening.reduce((sum, item) => sum + item.skippedCount, 0),
        risk_concepts: input.screening.flatMap((item) => item.riskConcepts.map((concept) => ({
          concept_id: concept.conceptId,
          concept_title: concept.conceptTitle,
          course_id: item.courseId,
          evidence_refs: [`screening:${item.courseId}:${concept.questionId}`],
          note: "起步筛查中出现未答对信号，仅用于安排首个复习方向。",
        }))),
      }
    : undefined;

  const profile = onboardingInitialProfileSchema.parse({
    profile_id: input.createId("onboarding_profile"),
    version: input.profileVersion,
    confidence: "low",
    evidence_status: "accumulating",
    confidence_explanation: screeningSummary
      ? "课程顺序综合四门自评与 8 题起步筛查信号；筛查只用于选择首个复习方向，后续仍以真实学习证据为准。"
      : "目前只依据学习设置与四门课程自评形成起步方向，客观学习证据正在积累。",
    generated_at: input.now.toISOString(),
    objective_evidence_count: 0,
    subjective_evidence_count: input.selfAssessments.length,
    priority_courses: priorityCourses,
    boundary_note: "初始学习方向不是能力测评，不代表分数、排名、录取概率或提分效果。",
    ...(screeningSummary ? { screening: screeningSummary } : {}),
  });

  const schedule = [
    { rank: 0, practice: true },
    { rank: 0, practice: false },
    { rank: 1, practice: true },
    { rank: 2, practice: false },
    { rank: 3, practice: true },
    { rank: 0, practice: true },
    { rank: 1, practice: false },
  ] as const;
  const tasksPerDay = Math.min(6, Math.max(1, Math.ceil(input.goals.daily_minutes / 60)));
  const availableQuarterHours = input.goals.daily_minutes / 15;
  const quarterHoursPerTask = Math.floor(availableQuarterHours / tasksPerDay);
  const extraQuarterHourTasks = availableQuarterHours % tasksPerDay;
  const conceptUseCount = new Map<OnboardingCourseId, number>();
  const scheduledTasks = Array.from({ length: 7 }, (_, dayIndex) => (
    Array.from({ length: tasksPerDay }, (_, orderIndex) => {
      const slot = schedule[(dayIndex + orderIndex) % schedule.length]!;
      const rankedCourse = ranked[slot.rank]!;
      const resource = rankedCourse.resource;
      const riskConcepts = rankedCourse.screening?.riskConcepts ?? [];
      const conceptIndex = conceptUseCount.get(resource.courseId) ?? 0;
      const riskConcept = riskConcepts.length > 0
        ? riskConcepts[conceptIndex % riskConcepts.length]
        : undefined;
      conceptUseCount.set(resource.courseId, conceptIndex + 1);
      const conceptId = riskConcept?.conceptId ?? resource.fallbackConcept.conceptId;
      const conceptTitle = riskConcept?.conceptTitle ?? resource.fallbackConcept.conceptTitle;
      const canPractice = (riskConcept?.practiceQuestionCount ?? resource.fallbackConcept.practiceQuestionCount) > 0;
      const practice = slot.practice && canPractice;
      const estimatedMinutes = (
        quarterHoursPerTask + (orderIndex < extraQuarterHourTasks ? 1 : 0)
      ) * 15;
      const href = practice
        ? `/student/practice?subject=${encodeURIComponent(resource.subject)}&concept_id=${encodeURIComponent(conceptId)}`
        : resource.courseHref;
      return {
        task_id: input.createId("onboarding_task"),
        day_index: dayIndex + 1,
        task_date: chinaCalendarDate(input.now, dayIndex),
        order: orderIndex + 1,
        course_id: resource.courseId,
        course_title: resource.courseTitle,
        concept_id: conceptId,
        concept_title: conceptTitle,
        task_type: practice ? "choice_practice" as const : "course_reading" as const,
        estimated_minutes: estimatedMinutes,
        title: practice ? `练习：${conceptTitle}` : `学习：${conceptTitle}`,
        reason: rankedCourse.screening?.incorrectCount
          ? `起步筛查把“${conceptTitle}”标为先复习方向，先建立基础理解再做真实题验证。`
          : `根据你的学习设置与课程自评，先建立“${conceptTitle}”的基础理解。`,
        completion_criteria: practice
          ? "完成至少一道相关选择题并查看结果。"
          : "进入课程讲解并完成该知识点的首段阅读。",
        href,
        evidence_refs: rankedCourse.evidenceRefs,
        status: "pending" as const,
      };
    })
  )).flat();

  // Practice may fall back to the same reading as another slot. Keep that
  // time in one block instead of assigning the identical activity twice.
  const tasks: typeof scheduledTasks = [];
  for (const task of scheduledTasks) {
    const dayTasks = tasks.filter((candidate) => candidate.day_index === task.day_index);
    const existing = dayTasks.find((candidate) => candidate.course_id === task.course_id
      && candidate.concept_id === task.concept_id && candidate.task_type === task.task_type);
    if (existing) {
      existing.estimated_minutes += task.estimated_minutes;
    } else {
      tasks.push({ ...task, order: dayTasks.length + 1 });
    }
  }

  const plan = onboardingLearningPlanSchema.parse({
    plan_id: input.createId("onboarding_plan"),
    version: input.planVersion,
    source: "deterministic_fallback",
    ai_status: "unavailable",
    ai_status_message: "AI 个性化编排尚未接入，当前路径由学习设置、真实课程结构和时间约束确定性生成。",
    start_date: chinaCalendarDate(input.now),
    daily_minutes: input.goals.daily_minutes,
    generated_at: input.now.toISOString(),
    tasks,
    today_task_id: tasks[0]!.task_id,
  });

  return { profile, plan };
}
