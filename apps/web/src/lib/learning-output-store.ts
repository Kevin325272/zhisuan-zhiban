import type { AbilityAssessmentKey } from "@xuetu/contracts";

export interface GeneratedReviewCard {
  id: string;
  sourceId: string;
  title: string;
  course: string;
  minutes: number;
  reason: string;
  href: string;
  scheduledFor: string;
}

export type AbilityGoal = "course_foundation" | "coding_practice" | "algorithm_advanced";
export type AbilityDiagnosticAnswer = 0 | 1 | 2;

export interface AbilityCalibration {
  goal: AbilityGoal;
  weeklyHours: 2 | 4 | 6;
  answers: {
    concept: AbilityDiagnosticAnswer;
    implementation: AbilityDiagnosticAnswer;
    transfer: AbilityDiagnosticAnswer;
  };
  focusKey: AbilityAssessmentKey;
  completedAt: string;
}

export type ReviewRating = "mastered" | "fuzzy" | "forgotten";

export interface ReviewFeedback {
  id: string;
  title: string;
  course: string;
  minutes: number;
  reason: string;
  href: string;
  scheduledFor: string;
  rating: ReviewRating;
  nextReviewFor: string;
  answeredAt: string;
}

export interface UploadedMaterial {
  id: string;
  title: string;
  mimeType: string;
  size: number;
  excerpt: string;
  uploadedAt: string;
}

export interface LearningOutputs {
  notes: Record<string, string>;
  reviewCards: GeneratedReviewCard[];
  abilityCalibration: AbilityCalibration | null;
  reviewFeedback: Record<string, ReviewFeedback>;
  uploadedMaterials: UploadedMaterial[];
}

const STORAGE_KEY = "xuetu.learning-outputs.v1";
const SCOPED_STORAGE_PREFIX = "xuetu.learning-outputs.v2.";
let learningOutputOwner: string | null = null;

/** Set by the authenticated session provider; never accepts a browser token. */
export function setLearningOutputOwner(userId: string | null) {
  learningOutputOwner = userId;
}

function storageKey() {
  return learningOutputOwner
    ? `${SCOPED_STORAGE_PREFIX}${encodeURIComponent(learningOutputOwner)}`
    : STORAGE_KEY;
}

function emptyOutputs(): LearningOutputs {
  return {
    notes: {},
    reviewCards: [],
    abilityCalibration: null,
    reviewFeedback: {},
    uploadedMaterials: [],
  };
}

function isGeneratedReviewCard(value: unknown): value is GeneratedReviewCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === "string" &&
    typeof card.sourceId === "string" &&
    typeof card.title === "string" &&
    typeof card.course === "string" &&
    typeof card.minutes === "number" &&
    typeof card.reason === "string" &&
    typeof card.href === "string" &&
    typeof card.scheduledFor === "string"
  );
}

function isAbilityDiagnosticAnswer(value: unknown): value is AbilityDiagnosticAnswer {
  return typeof value === "number" && [0, 1, 2].includes(value);
}

function isAbilityCalibration(value: unknown): value is AbilityCalibration {
  if (!value || typeof value !== "object") return false;
  const calibration = value as Record<string, unknown>;
  const answers = calibration.answers;
  const answerValues = answers as Record<string, unknown>;
  const validGoals: AbilityGoal[] = [
    "course_foundation",
    "coding_practice",
    "algorithm_advanced",
  ];
  const validFocusKeys: AbilityAssessmentKey[] = [
    "knowledge_understanding",
    "algorithmic_thinking",
    "code_implementation",
    "debugging_diagnosis",
    "system_thinking",
    "transfer_application",
  ];

  return (
    validGoals.includes(calibration.goal as AbilityGoal) &&
    [2, 4, 6].includes(calibration.weeklyHours as number) &&
    typeof answers === "object" &&
    answers !== null &&
    isAbilityDiagnosticAnswer(answerValues.concept) &&
    isAbilityDiagnosticAnswer(answerValues.implementation) &&
    isAbilityDiagnosticAnswer(answerValues.transfer) &&
    validFocusKeys.includes(calibration.focusKey as AbilityAssessmentKey) &&
    typeof calibration.completedAt === "string"
  );
}

function isReviewFeedback(value: unknown): value is ReviewFeedback {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Record<string, unknown>;
  return (
    typeof feedback.id === "string" &&
    typeof feedback.title === "string" &&
    typeof feedback.course === "string" &&
    typeof feedback.minutes === "number" &&
    typeof feedback.reason === "string" &&
    typeof feedback.href === "string" &&
    typeof feedback.scheduledFor === "string" &&
    ["mastered", "fuzzy", "forgotten"].includes(String(feedback.rating)) &&
    typeof feedback.nextReviewFor === "string" &&
    typeof feedback.answeredAt === "string"
  );
}

function isUploadedMaterial(value: unknown): value is UploadedMaterial {
  if (!value || typeof value !== "object") return false;
  const material = value as Record<string, unknown>;
  return (
    typeof material.id === "string" &&
    typeof material.title === "string" &&
    typeof material.mimeType === "string" &&
    typeof material.size === "number" &&
    typeof material.excerpt === "string" &&
    typeof material.uploadedAt === "string"
  );
}

function dedupeReviewCards(cards: GeneratedReviewCard[]) {
  return cards.filter(
    (card, index) =>
      cards.findIndex(
        (candidate) =>
          candidate.title === card.title &&
          candidate.course === card.course &&
          candidate.scheduledFor === card.scheduledFor,
      ) === index,
  );
}

export function loadLearningOutputs(): LearningOutputs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey());
    // Preserve the existing local demo student's notes/cards on first real
    // login, but never share them with a different account.
    if (!raw && learningOutputOwner === "user_student_001") {
      raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) window.localStorage.setItem(storageKey(), raw);
    }
  } catch {
    return emptyOutputs();
  }
  try {
    if (!raw) return emptyOutputs();

    const parsed = JSON.parse(raw) as {
      notes?: unknown;
      reviewCards?: unknown;
      abilityCalibration?: unknown;
      reviewFeedback?: unknown;
      uploadedMaterials?: unknown;
    };
    const notes = parsed.notes && typeof parsed.notes === "object"
      ? Object.fromEntries(
          Object.entries(parsed.notes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : {};
    const reviewCards = Array.isArray(parsed.reviewCards)
      ? dedupeReviewCards(parsed.reviewCards.filter(isGeneratedReviewCard))
      : [];
    const reviewFeedback = parsed.reviewFeedback && typeof parsed.reviewFeedback === "object"
      ? Object.fromEntries(
          Object.entries(parsed.reviewFeedback).filter(
            (entry): entry is [string, ReviewFeedback] => isReviewFeedback(entry[1]),
          ),
        )
      : {};
    const uploadedMaterials = Array.isArray(parsed.uploadedMaterials)
      ? parsed.uploadedMaterials.filter(isUploadedMaterial)
      : [];

    return {
      notes,
      reviewCards,
      abilityCalibration: isAbilityCalibration(parsed.abilityCalibration)
        ? parsed.abilityCalibration
        : null,
      reviewFeedback,
      uploadedMaterials,
    };
  } catch {
    // 解析失败时保留原始串备份，避免静默清空用户的笔记与复习卡。
    try {
      if (raw) window.localStorage.setItem(`${storageKey()}.backup`, raw);
    } catch {
      // 备份失败可忽略。
    }
    return emptyOutputs();
  }
}

function persistLearningOutputs(outputs: LearningOutputs) {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(outputs));
  } catch {
    // 配额超限或隐私模式：本地持久化失败不应让“提交成功”被渲染成失败。
  }
}

export function saveMaterialNote(sourceId: string, content: string) {
  const outputs = loadLearningOutputs();
  const next = {
    ...outputs,
    notes: { ...outputs.notes, [sourceId]: content },
  };
  persistLearningOutputs(next);
  return next;
}

export function addGeneratedReviewCard(card: GeneratedReviewCard) {
  const outputs = loadLearningOutputs();
  const semanticDuplicate = outputs.reviewCards.some(
    (item) =>
      item.id !== card.id &&
      item.title === card.title &&
      item.course === card.course &&
      item.scheduledFor === card.scheduledFor,
  );
  if (semanticDuplicate) return outputs;

  const next = {
    ...outputs,
    reviewCards: [...outputs.reviewCards.filter((item) => item.id !== card.id), card],
  };
  persistLearningOutputs(next);
  return next;
}

export function saveAbilityCalibration(calibration: AbilityCalibration) {
  const outputs = loadLearningOutputs();
  const next = { ...outputs, abilityCalibration: calibration };
  persistLearningOutputs(next);
  return next;
}

export function saveReviewFeedback(feedback: ReviewFeedback) {
  const outputs = loadLearningOutputs();
  const next = {
    ...outputs,
    reviewFeedback: { ...outputs.reviewFeedback, [feedback.id]: feedback },
  };
  persistLearningOutputs(next);
  return next;
}

export function saveUploadedMaterial(material: UploadedMaterial) {
  const outputs = loadLearningOutputs();
  const next = {
    ...outputs,
    uploadedMaterials: [
      ...outputs.uploadedMaterials.filter((item) => item.id !== material.id),
      material,
    ],
  };
  persistLearningOutputs(next);
  return next;
}
