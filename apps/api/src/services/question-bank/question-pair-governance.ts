export type QuestionPairRole = "anchor" | "contrast" | "transfer";
type QuestionSourceType = "past_exam" | "mock_exam" | "self_authored_screening" | "self_authored_practice";
type QuestionReviewStatus = "unreviewed" | "pending_review" | "approved" | "rejected";
type ContentReviewStatus = "pending_teacher_review" | "teacher_verified";
type UsageScope = "local_demo_only" | "authorized_product_use";
type LicenseStatus = "unverified" | "verified" | "restricted";

export interface QuestionPairCandidate {
  pair_group_id: string;
  course_id: string;
  concept_id: string;
  question_id: string;
  contrast_question_id: string;
  /** Optional denormalized course id used by import validation. */
  contrast_course_id?: string;
  /** Optional denormalized concept id used by import validation. */
  contrast_concept_id?: string;
  anchor_course_id?: string;
  anchor_concept_id?: string;
  hypothesis_code: string;
  surface_difference: string;
  question_role: QuestionPairRole;
  content_review_status: "pending_teacher_review" | "teacher_verified" | "disabled";
  status: "active" | "disabled";
  algorithm_version: "evidence_probe_v1";
  /** Governed question fields loaded by the PostgreSQL selection query. */
  /** When an anchor comes from the shared 408 question container, this is the
   * subject catalog course that establishes its governed sub-course scope. */
  anchor_catalog_course_id?: string;
  anchor_question_type?: "choice" | "subjective";
  anchor_review_status?: QuestionReviewStatus;
  anchor_content_review_status?: ContentReviewStatus;
  anchor_allowed_modes?: readonly string[];
  anchor_protect_full_paper?: boolean;
  anchor_source_type?: QuestionSourceType;
  anchor_usage_scope?: UsageScope;
  anchor_license_status?: LicenseStatus;
  anchor_assets_complete?: boolean;
  contrast_question_type?: "choice" | "subjective";
  contrast_review_status?: QuestionReviewStatus;
  contrast_content_review_status?: ContentReviewStatus;
  contrast_allowed_modes?: readonly string[];
  contrast_protect_full_paper?: boolean;
  contrast_source_type?: QuestionSourceType;
  contrast_usage_scope?: UsageScope;
  contrast_license_status?: LicenseStatus;
  contrast_assets_complete?: boolean;
}

export type QuestionPairValidationFailure =
  | "same_question"
  | "cross_course"
  | "cross_concept"
  | "not_verified"
  | "disabled"
  | "invalid_role"
  | "invalid_question_type"
  | "not_student_visible"
  | "missing_hypothesis"
  | "missing_surface_difference";

interface GovernedQuestionCandidate {
  question_type: QuestionPairCandidate["anchor_question_type"];
  review_status: QuestionPairCandidate["anchor_review_status"];
  content_review_status: QuestionPairCandidate["anchor_content_review_status"];
  allowed_modes: QuestionPairCandidate["anchor_allowed_modes"];
  protect_full_paper: QuestionPairCandidate["anchor_protect_full_paper"];
  source_type: QuestionPairCandidate["anchor_source_type"];
  usage_scope: QuestionPairCandidate["anchor_usage_scope"];
  license_status: QuestionPairCandidate["anchor_license_status"];
  assets_complete: QuestionPairCandidate["anchor_assets_complete"];
}

function validateGovernedQuestion(
  question: GovernedQuestionCandidate,
): QuestionPairValidationFailure | null {
  if (question.question_type !== "choice") return "invalid_question_type";
  if (question.review_status !== "approved" || question.content_review_status !== "teacher_verified") {
    return "not_verified";
  }
  if (
    !question.allowed_modes?.includes("targeted")
    || question.protect_full_paper !== false
    || question.assets_complete !== true
    || question.source_type === "self_authored_screening"
  ) {
    return "not_student_visible";
  }
  if (
    question.source_type !== "self_authored_practice"
    && (
      question.usage_scope !== "authorized_product_use"
      || question.license_status !== "verified"
    )
  ) {
    return "not_student_visible";
  }
  return null;
}

export function validateQuestionPair(
  candidate: QuestionPairCandidate,
): { ok: true } | { ok: false; reason: QuestionPairValidationFailure } {
  if (candidate.question_id === candidate.contrast_question_id) {
    return { ok: false, reason: "same_question" };
  }
  if (candidate.question_role === "anchor") {
    return { ok: false, reason: "invalid_role" };
  }
  const anchorCourseMatches = candidate.anchor_course_id === undefined
    || candidate.anchor_course_id === candidate.course_id
    || (
      candidate.anchor_course_id === "course_408_001"
      && candidate.anchor_catalog_course_id === candidate.course_id
    );
  if (!anchorCourseMatches) {
    return { ok: false, reason: "cross_course" };
  }
  if (candidate.anchor_concept_id !== undefined && candidate.anchor_concept_id !== candidate.concept_id) {
    return { ok: false, reason: "cross_concept" };
  }
  if (candidate.contrast_course_id !== undefined && candidate.contrast_course_id !== candidate.course_id) {
    return { ok: false, reason: "cross_course" };
  }
  if (candidate.contrast_concept_id !== undefined && candidate.contrast_concept_id !== candidate.concept_id) {
    return { ok: false, reason: "cross_concept" };
  }
  if (candidate.content_review_status !== "teacher_verified") {
    return { ok: false, reason: "not_verified" };
  }
  if (candidate.status !== "active") {
    return { ok: false, reason: "disabled" };
  }
  const anchorFailure = validateGovernedQuestion({
    question_type: candidate.anchor_question_type,
    review_status: candidate.anchor_review_status,
    content_review_status: candidate.anchor_content_review_status,
    allowed_modes: candidate.anchor_allowed_modes,
    protect_full_paper: candidate.anchor_protect_full_paper,
    source_type: candidate.anchor_source_type,
    usage_scope: candidate.anchor_usage_scope,
    license_status: candidate.anchor_license_status,
    assets_complete: candidate.anchor_assets_complete,
  });
  if (anchorFailure) return { ok: false, reason: anchorFailure };
  const contrastFailure = validateGovernedQuestion({
    question_type: candidate.contrast_question_type,
    review_status: candidate.contrast_review_status,
    content_review_status: candidate.contrast_content_review_status,
    allowed_modes: candidate.contrast_allowed_modes,
    protect_full_paper: candidate.contrast_protect_full_paper,
    source_type: candidate.contrast_source_type,
    usage_scope: candidate.contrast_usage_scope,
    license_status: candidate.contrast_license_status,
    assets_complete: candidate.contrast_assets_complete,
  });
  if (contrastFailure) return { ok: false, reason: contrastFailure };
  if (!candidate.hypothesis_code.trim()) {
    return { ok: false, reason: "missing_hypothesis" };
  }
  if (candidate.surface_difference.trim().length < 8) {
    return { ok: false, reason: "missing_surface_difference" };
  }
  return { ok: true };
}
