import {
  PERSONAL_LEARNING_DIMENSION_KEYS,
  personalLearningDashboardSchema,
  type LearningConceptProgress,
  type LearningCourseRecord,
  type LearningRecord,
  type PersonalLearningDashboard,
  type PersonalLearningDimension,
  type PersonalLearningDimensionKey,
  type PersonalLearningEvidenceLevel,
  type PracticeMistakeRecord,
} from "@xuetu/contracts";

const DIMENSION_LABELS: Record<PersonalLearningDimensionKey, string> = {
  knowledge_coverage: "知识覆盖",
  practice_coverage: "练习覆盖",
  answer_accuracy: "作答准确",
  mistake_recovery: "错题修复",
  mastery_stability: "掌握稳定",
};

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function evidenceLevel(count: number, breadth = count): PersonalLearningEvidenceLevel {
  if (count === 0) return "none";
  return count < 3 || breadth < 2 ? "limited" : "grounded";
}

function dimension(
  key: PersonalLearningDimensionKey,
  score: number | null,
  evidenceCount: number,
  explanation: string,
  recommendation: string,
  evidenceBreadth = evidenceCount,
): PersonalLearningDimension {
  return {
    key,
    label: DIMENSION_LABELS[key],
    score,
    evidence_count: evidenceCount,
    evidence_level: evidenceLevel(evidenceCount, evidenceBreadth),
    explanation,
    recommendation,
  };
}

function dimensionsFor(
  course: LearningCourseRecord,
  mistakes: PracticeMistakeRecord[],
): PersonalLearningDimension[] {
  const practicedConcepts = course.concepts.filter((concept) => concept.attempt_count > 0);
  const stableConcepts = practicedConcepts.filter((concept) => concept.status === "mastered");
  const evaluatedAttempts = course.correct_count + course.incorrect_count;
  const recoveredMistakes = mistakes.filter((mistake) => mistake.status === "mastered").length;
  const mistakeBreadth = new Set(
    mistakes.map((mistake) => mistake.concept_id ?? `question:${mistake.question_id}`),
  ).size;

  return [
    dimension(
      "knowledge_coverage",
      percentage(course.started_concept_count, course.concept_count),
      course.started_concept_count,
      `已开始 ${course.started_concept_count}/${course.concept_count} 个知识点。`,
      course.started_concept_count < course.concept_count
        ? "继续知识地图中尚未开始的核心知识点。"
        : "保持课程覆盖，并通过练习验证理解。",
    ),
    dimension(
      "practice_coverage",
      percentage(practicedConcepts.length, course.concept_count),
      practicedConcepts.length,
      `已练习 ${practicedConcepts.length}/${course.concept_count} 个知识点。`,
      "优先练习已经阅读但尚未作答的知识点。",
    ),
    dimension(
      "answer_accuracy",
      percentage(course.correct_count, evaluatedAttempts),
      evaluatedAttempts,
      evaluatedAttempts > 0
        ? `${evaluatedAttempts} 次已评作答，答对 ${course.correct_count} 次。`
        : "完成选择题后，将显示作答准确率。",
      "结合做错的题目，回看对应概念。",
      practicedConcepts.length,
    ),
    dimension(
      "mistake_recovery",
      percentage(recoveredMistakes, mistakes.length),
      mistakes.length,
      mistakes.length > 0
        ? `${mistakes.length} 道错题，已巩固 ${recoveredMistakes} 道。`
        : "这门课程还没有错题记录。",
      "重练待复习错题，逐步巩固易错之处。",
      mistakeBreadth,
    ),
    dimension(
      "mastery_stability",
      percentage(stableConcepts.length, practicedConcepts.length),
      practicedConcepts.length,
      practicedConcepts.length > 0
        ? `${practicedConcepts.length} 个已练知识点，${stableConcepts.length} 个已稳定掌握。`
        : "完成练习和复习后，逐步积累掌握记录。",
      "按时复习，再尝试同一知识点的不同题目。",
    ),
  ];
}

function chooseStrongest(dimensions: PersonalLearningDimension[]) {
  return dimensions
    .filter((item) => item.score !== null && item.evidence_level === "grounded")
    .reduce<PersonalLearningDimension | null>((best, item) => (
      !best || (item.score ?? -1) > (best.score ?? -1) ? item : best
    ), null)?.key ?? null;
}

function choosePriority(
  dimensions: PersonalLearningDimension[],
  needsReviewCount: number,
) {
  if (needsReviewCount > 0) {
    const recovery = dimensions.find((item) => item.key === "mistake_recovery");
    if (recovery && recovery.score !== null && recovery.evidence_count > 0) return recovery.key;
  }
  return dimensions
    .filter((item) => item.score !== null && item.evidence_count > 0)
    .reduce<PersonalLearningDimension | null>((weakest, item) => (
      !weakest || (item.score ?? 101) < (weakest.score ?? 101) ? item : weakest
    ), null)?.key ?? null;
}

function conceptPriority(concepts: LearningConceptProgress[]) {
  const needsReview = concepts.find((concept) => concept.status === "needs_review");
  if (needsReview) return needsReview;
  const reading = concepts.find((concept) => concept.status === "reading");
  if (reading) return reading;
  const practiced = concepts
    .filter((concept) => concept.attempt_count > 0)
    .sort((left, right) => (
      (left.correct_count / left.attempt_count) - (right.correct_count / right.attempt_count)
    ))[0];
  if (practiced) return practiced;
  return null;
}

function nextAction(
  course: LearningCourseRecord,
  priorityConcept: LearningConceptProgress | null,
  mistakes: PracticeMistakeRecord[],
) {
  if (course.started_concept_count === 0 && course.practice_attempt_count === 0) {
    return {
      kind: "start_course" as const,
      label: "从课程知识地图开始学习",
      concept_id: null,
    };
  }
  if (mistakes.some((mistake) => mistake.status === "needs_review")) {
    return {
      kind: "review_mistakes" as const,
      label: `复习 ${course.needs_review_count} 个待巩固知识点`,
      concept_id: priorityConcept?.concept_id ?? null,
    };
  }
  if (priorityConcept && (priorityConcept.practice_question_count ?? 0) > 0) {
    return {
      kind: "practice_concept" as const,
      label: `练习“${priorityConcept.title}”`,
      concept_id: priorityConcept.concept_id,
    };
  }
  return {
    kind: "continue_course" as const,
    label: "继续课程学习",
    concept_id: priorityConcept?.concept_id ?? null,
  };
}

export function buildPersonalLearningDashboard(
  record: LearningRecord,
  mistakes: PracticeMistakeRecord[],
): PersonalLearningDashboard {
  const courses = record.courses.map((course) => {
    const courseMistakes = mistakes.filter((mistake) => mistake.course_id === course.course_id);
    const recentMistakes = courseMistakes.slice(0, 3);
    const courseDimensions = dimensionsFor(course, courseMistakes);
    const readingOnlyConceptCount = course.concepts.filter((concept) => concept.status === "reading").length;
    const independentActivityCount = course.practice_attempt_count + readingOnlyConceptCount;
    const level = evidenceLevel(independentActivityCount, course.started_concept_count);
    const priorityConcept = level === "none" ? null : conceptPriority(course.concepts);

    return {
      course_id: course.course_id,
      title: course.title,
      concept_count: course.concept_count,
      started_concept_count: course.started_concept_count,
      practice_attempt_count: course.practice_attempt_count,
      correct_count: course.correct_count,
      incorrect_count: course.incorrect_count,
      needs_review_count: course.needs_review_count,
      mastered_count: course.mastered_count,
      evidence_level: level,
      dimensions: PERSONAL_LEARNING_DIMENSION_KEYS.map((key) => (
        courseDimensions.find((item) => item.key === key)!
      )),
      strongest_dimension_key: chooseStrongest(courseDimensions),
      priority_dimension_key: choosePriority(courseDimensions, course.needs_review_count),
      priority_concept: priorityConcept,
      recent_mistakes: recentMistakes,
      next_action: nextAction(course, priorityConcept, courseMistakes),
    };
  });

  return personalLearningDashboardSchema.parse({
    generated_at: record.generated_at,
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
    courses,
  });
}
