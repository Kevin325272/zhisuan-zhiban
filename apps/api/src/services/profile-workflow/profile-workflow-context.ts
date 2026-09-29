import type {
  OnboardingState,
  PersonalLearningCourse,
  PersonalLearningDashboard,
  PersonalLearningNextAction,
  StudentProfileCourseProgress,
  StudentProfileEvidenceSummary,
  StudentProfileNextTask,
  StudentProfileWorkflowResponse,
} from "@xuetu/contracts";

import type { StudentOnboardingService } from "../onboarding/student-onboarding.js";
import type { ReliableLearningLoopService } from "../question-bank/reliable-learning-loop.js";

export interface ProfileWorkflowInputs {
  profile_id: string;
  learning_goal: string;
  course_self_assessments: string;
  backend_portrait_basis: string;
  learning_evidence_summary: string;
  response_language: "zh-CN";
  request_id: string;
}

export interface ProfileWorkflowContext {
  request_id: string;
  user_id: string;
  profile_id: string;
  inputs: ProfileWorkflowInputs;
  course_progress: StudentProfileCourseProgress[];
  evidence_summary: StudentProfileEvidenceSummary;
  allowed_course_ids: Set<string>;
  allowed_concept_ids: Set<string>;
  allowed_evidence_ids: Set<string>;
  strength_candidates: ReadonlyMap<string, StudentProfileWorkflowResponse["strengths"][number]>;
  gap_candidates: ReadonlyMap<string, StudentProfileWorkflowResponse["priority_gaps"][number]>;
  task_candidates: ReadonlyMap<string, StudentProfileNextTask>;
}

export interface ProfileWorkflowContextRepository {
  build(userId: string, requestId: string, courseId: string): Promise<ProfileWorkflowContext | null>;
}

type OnboardingReader = Pick<StudentOnboardingService, "getState">;
type DashboardReader = Pick<ReliableLearningLoopService, "getPersonalLearningDashboard">;

function json(value: unknown) {
  return JSON.stringify(value);
}

function evidenceIdsForCourse(course: PersonalLearningCourse) {
  const ids = [`self:${course.course_id}`];
  if (course.started_concept_count > 0) ids.push(`reading:${course.course_id}`);
  if (course.practice_attempt_count > 0) ids.push(`practice:${course.course_id}`);
  if (course.needs_review_count > 0) ids.push(`mistake:${course.course_id}`);
  return ids;
}

function toCourseProgress(course: PersonalLearningCourse): StudentProfileCourseProgress {
  return {
    course_id: course.course_id,
    course_title: course.title,
    evidence_level: course.evidence_level,
    concept_count: course.concept_count,
    started_concept_count: course.started_concept_count,
    practice_attempt_count: course.practice_attempt_count,
    correct_count: course.correct_count,
    incorrect_count: course.incorrect_count,
    needs_review_count: course.needs_review_count,
  };
}

function evidenceIdsForDimension(course: PersonalLearningCourse) {
  return evidenceIdsForCourse(course);
}

function dimensionByKey(
  course: PersonalLearningCourse,
  key: PersonalLearningCourse["dimensions"][number]["key"] | null,
) {
  return key ? course.dimensions.find((dimension) => dimension.key === key) ?? null : null;
}

function candidateId(prefix: "strength" | "gap" | "task", ...parts: Array<string | null>) {
  const suffix = parts
    .filter((part): part is string => Boolean(part))
    .join("_")
    .replace(/[^a-zA-Z0-9_-]/gu, "_");
  return `${prefix}_${suffix}`.slice(0, 200);
}

function candidateStrength(course: PersonalLearningCourse) {
  const dimension = dimensionByKey(course, course.strongest_dimension_key);
  if (!dimension || dimension.score === null || dimension.evidence_count === 0) return null;
  return {
    candidate_id: candidateId("strength", course.course_id, dimension.key),
    course_id: course.course_id,
    course_title: course.title,
    dimension_key: dimension.key,
    title: `${course.title} · ${dimension.label}`,
    detail: dimension.explanation,
    evidence_ids: evidenceIdsForDimension(course),
  };
}

function candidateGap(course: PersonalLearningCourse) {
  const dimension = dimensionByKey(course, course.priority_dimension_key);
  const concept = course.priority_concept;
  if (!dimension || dimension.score === null || dimension.evidence_count === 0) return null;
  return {
    candidate_id: candidateId("gap", course.course_id, dimension.key, concept?.concept_id ?? null),
    course_id: course.course_id,
    course_title: course.title,
    dimension_key: dimension.key,
    concept_id: concept?.concept_id ?? null,
    title: concept ? `${course.title} · ${concept.title}` : `${course.title} · ${dimension.label}`,
    detail: dimension.recommendation,
    evidence_ids: evidenceIdsForDimension(course),
  };
}

function estimatedMinutes(action: PersonalLearningNextAction) {
  switch (action.kind) {
    case "review_mistakes":
      return 20;
    case "practice_concept":
      return 25;
    case "start_course":
      return 30;
    case "continue_course":
      return 30;
  }
}

function candidateTask(course: PersonalLearningCourse) {
  const action = course.next_action;
  return {
    candidate_id: candidateId("task", course.course_id, action.kind, action.concept_id),
    course_id: course.course_id,
    course_title: course.title,
    concept_id: action.concept_id,
    title: action.label,
    reason: `根据当前课程的确定性学习记录，${action.label}。`,
    estimated_minutes: estimatedMinutes(action),
    evidence_ids: evidenceIdsForDimension(course),
  };
}

function portraitCandidates(dashboard: PersonalLearningDashboard) {
  return {
    strengths: dashboard.courses
      .map(candidateStrength)
      .filter((candidate): candidate is NonNullable<ReturnType<typeof candidateStrength>> => candidate !== null),
    gaps: dashboard.courses
      .map(candidateGap)
      .filter((candidate): candidate is NonNullable<ReturnType<typeof candidateGap>> => candidate !== null),
    tasks: dashboard.courses.map(candidateTask),
  };
}

function portraitBasis(
  dashboard: PersonalLearningDashboard,
  candidates: ReturnType<typeof portraitCandidates>,
) {
  return {
    generated_at: dashboard.generated_at,
    courses: dashboard.courses.map((course) => ({
      course_id: course.course_id,
      title: course.title,
      evidence_level: course.evidence_level,
      concept_count: course.concept_count,
      started_concept_count: course.started_concept_count,
      practice_attempt_count: course.practice_attempt_count,
      correct_count: course.correct_count,
      incorrect_count: course.incorrect_count,
      needs_review_count: course.needs_review_count,
      mastered_count: course.mastered_count,
      priority_dimension_key: course.priority_dimension_key,
      strongest_dimension_key: course.strongest_dimension_key,
      dimensions: course.dimensions.map((dimension) => ({
        key: dimension.key,
        label: dimension.label,
        score: dimension.score,
        evidence_count: dimension.evidence_count,
        evidence_level: dimension.evidence_level,
      })),
      priority_concept: course.priority_concept
        ? {
            concept_id: course.priority_concept.concept_id,
            title: course.priority_concept.title,
            status: course.priority_concept.status,
            attempt_count: course.priority_concept.attempt_count,
            correct_count: course.priority_concept.correct_count,
            incorrect_count: course.priority_concept.incorrect_count,
            mistake_count: course.priority_concept.mistake_count,
            practice_question_count: course.priority_concept.practice_question_count,
          }
        : null,
    })),
    strength_candidates: candidates.strengths,
    priority_gap_candidates: candidates.gaps,
    allowed_next_tasks: candidates.tasks,
  };
}

function insightCandidateMap(
  candidates: Array<ReturnType<typeof candidateStrength> | ReturnType<typeof candidateGap>>,
) {
  return new Map(candidates.flatMap((candidate) => candidate
    ? [[candidate.candidate_id, {
        course_id: candidate.course_id,
        title: candidate.title,
        detail: candidate.detail,
        evidence_ids: candidate.evidence_ids,
      }] as const]
    : []));
}

function taskCandidateMap(candidates: ReturnType<typeof candidateTask>[]) {
  return new Map(candidates.map((candidate) => [candidate.candidate_id, {
    title: candidate.title,
    reason: candidate.reason,
    course_id: candidate.course_id,
    concept_id: candidate.concept_id,
    estimated_minutes: candidate.estimated_minutes,
    evidence_ids: candidate.evidence_ids,
  }] as const));
}

function evidenceSummary(
  state: OnboardingState,
  dashboard: PersonalLearningDashboard,
  evidenceIds: string[],
): StudentProfileEvidenceSummary {
  const readingProgressCount = dashboard.courses.filter(
    (course) => course.started_concept_count > 0,
  ).length;
  const objectiveEvidenceCount =
    dashboard.totals.practice_attempt_count + readingProgressCount;
  const scopedCourseIds = new Set(dashboard.courses.map((course) => course.course_id));
  const subjectiveEvidenceCount = state.self_assessments.filter(
    (assessment) => scopedCourseIds.has(assessment.course_id),
  ).length;
  return {
    objective_evidence_count: objectiveEvidenceCount,
    subjective_evidence_count: subjectiveEvidenceCount,
    reading_progress_count: readingProgressCount,
    practice_attempt_count: dashboard.totals.practice_attempt_count,
    needs_review_count: dashboard.totals.needs_review_count,
    explanation: objectiveEvidenceCount > 0
      ? "画像解读只使用当前账户的课程阅读、确定性选择题和错题复习记录；分数与状态仍由平台规则计算。"
      : "当前只有学习设置和课程自评，客观学习证据仍在积累。",
  };
}

/** Builds a privacy-filtered, source-bounded input for the profile workflow. */
export class StudentProfileWorkflowContextRepositoryImpl
  implements ProfileWorkflowContextRepository {
  constructor(
    private readonly onboarding: OnboardingReader,
    private readonly dashboard: DashboardReader,
  ) {}

  async build(
    userId: string,
    requestId: string,
    courseId: string,
  ): Promise<ProfileWorkflowContext | null> {
    const state = await this.onboarding.getState(userId);
    if (state.status !== "completed" || !state.profile) return null;

    const fullDashboard = await this.dashboard.getPersonalLearningDashboard(userId);
    const courses = fullDashboard.courses.filter((course) => course.course_id === courseId);
    if (courses.length !== 1) return null;
    const dashboard: PersonalLearningDashboard = {
      ...fullDashboard,
      courses,
      totals: courses.reduce((totals, course) => ({
        course_count: totals.course_count + 1,
        concept_count: totals.concept_count + course.concept_count,
        started_concept_count: totals.started_concept_count + course.started_concept_count,
        practice_attempt_count: totals.practice_attempt_count + course.practice_attempt_count,
        correct_count: totals.correct_count + course.correct_count,
        incorrect_count: totals.incorrect_count + course.incorrect_count,
        needs_review_count: totals.needs_review_count + course.needs_review_count,
      }), {
        course_count: 0,
        concept_count: 0,
        started_concept_count: 0,
        practice_attempt_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        needs_review_count: 0,
      }),
    };
    const courseProgress = dashboard.courses.map(toCourseProgress);
    const allowedCourseIds = new Set(courseProgress.map((course) => course.course_id));
    const allowedConceptIds = new Set(
      dashboard.courses
        .flatMap((course) => course.priority_concept?.concept_id ?? [])
        .filter(Boolean),
    );
    const evidenceIds = dashboard.courses.flatMap(evidenceIdsForCourse);
    const allowedEvidenceIds = new Set(evidenceIds);
    const summary = evidenceSummary(state, dashboard, evidenceIds);
    const candidates = portraitCandidates(dashboard);
    const selfAssessments = Object.fromEntries(
      state.self_assessments
        .filter((assessment) => assessment.course_id === courseId)
        .map((assessment) => [assessment.course_id, assessment.level]),
    );

    const inputs: ProfileWorkflowInputs = {
      profile_id: state.profile.profile_id,
      learning_goal: json(state.goals ?? {}),
      course_self_assessments: json(selfAssessments),
      backend_portrait_basis: json(portraitBasis(dashboard, candidates)),
      learning_evidence_summary: json({
        ...summary,
        evidence_ids: evidenceIds,
      }),
      response_language: "zh-CN",
      request_id: requestId,
    };

    return {
      request_id: requestId,
      user_id: userId,
      profile_id: state.profile.profile_id,
      inputs,
      course_progress: courseProgress,
      evidence_summary: summary,
      allowed_course_ids: allowedCourseIds,
      allowed_concept_ids: allowedConceptIds,
      allowed_evidence_ids: allowedEvidenceIds,
      strength_candidates: insightCandidateMap(candidates.strengths),
      gap_candidates: insightCandidateMap(candidates.gaps),
      task_candidates: taskCandidateMap(candidates.tasks),
    };
  }
}

// Keep the short name used by tests and route wiring while retaining the
// explicit implementation suffix for future repository variants.
export { StudentProfileWorkflowContextRepositoryImpl as StudentProfileWorkflowContextRepository };
