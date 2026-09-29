import type {
  ExternalQuestionConceptCandidate,
  ExternalQuestionConfirmation,
  ExternalQuestionExplanation,
  ExternalQuestionModelTrace,
  ExternalQuestionRecognition,
} from "@xuetu/contracts";

export type ExternalQuestionInternalStatus =
  | "recognition_failed"
  | "needs_better_image"
  | "unsupported"
  | "recognized"
  | "confirmed"
  | "deleted";

export type ExternalQuestionRepositoryErrorCode =
  | "EXTERNAL_QUESTION_NOT_FOUND"
  | "EXTERNAL_QUESTION_EXPIRED"
  | "EXTERNAL_QUESTION_INVALID_STATE"
  | "EXTERNAL_QUESTION_TEMPORARY_LIMIT"
  | "EXTERNAL_QUESTION_SAVED_LIMIT"
  | "EXTERNAL_QUESTION_SAVED_BYTES_LIMIT"
  | "EXTERNAL_QUESTION_IDEMPOTENCY_CONFLICT";

export class ExternalQuestionRepositoryError extends Error {
  constructor(
    readonly code: ExternalQuestionRepositoryErrorCode,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ExternalQuestionRepositoryError";
  }
}

export type ExternalQuestionAiFailureCode =
  | "UPSTREAM_UNAVAILABLE"
  | "WORKFLOW_TIMEOUT"
  | "IMAGE_INPUT_UNAVAILABLE"
  | "RECOGNITION_INVALID_RESPONSE"
  | "EXPLANATION_INVALID_RESPONSE";

export class ExternalQuestionAiError extends Error {
  constructor(
    readonly code: ExternalQuestionAiFailureCode,
    readonly statusCode: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ExternalQuestionAiError";
  }
}

export class ExternalQuestionRequestAbortedError extends Error {
  constructor() {
    super("客户端已取消本次请求。");
    this.name = "ExternalQuestionRequestAbortedError";
  }
}

export interface ExternalQuestionImageRecord {
  storageRef: string;
  sha256: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  byteSize: number;
}

export interface StoredExternalQuestionExplanation {
  explanationId: string;
  contentRevision: number;
  explanation: ExternalQuestionExplanation;
  modelTrace: ExternalQuestionModelTrace | null;
  createdAt: string;
}

export interface StoredExternalQuestion {
  externalQuestionId: string;
  userId: string;
  status: Exclude<ExternalQuestionInternalStatus, "deleted">;
  contentRevision: number;
  image: ExternalQuestionImageRecord;
  recognition: ExternalQuestionRecognition | null;
  confirmation: ExternalQuestionConfirmation | null;
  conceptCandidates: ExternalQuestionConceptCandidate[];
  explanations: StoredExternalQuestionExplanation[];
  modelTrace: ExternalQuestionModelTrace | null;
  savedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalQuestionCleanupRef {
  externalQuestionId: string;
  storageRef: string;
}

export interface ExternalQuestionAiGateway {
  recognize(input: {
    requestId: string;
    imageBytes: Buffer;
    signal?: AbortSignal;
  }): Promise<{
    recognition: ExternalQuestionRecognition;
    modelTrace: ExternalQuestionModelTrace;
  }>;
  explain(input: {
    requestId: string;
    confirmation: ExternalQuestionConfirmation;
    conceptCandidates: ExternalQuestionConceptCandidate[];
    depth: "direction" | "steps" | "complete";
    signal?: AbortSignal;
  }): Promise<{
    explanation: ExternalQuestionExplanation;
    modelTrace: ExternalQuestionModelTrace;
  }>;
}

export class UnavailableExternalQuestionAiGateway implements ExternalQuestionAiGateway {
  async recognize(_input: {
    requestId: string;
    imageBytes: Buffer;
  }): Promise<never> {
    throw new ExternalQuestionAiError(
      "UPSTREAM_UNAVAILABLE",
      503,
      false,
      "AI 讲题服务尚未配置。",
    );
  }

  async explain(_input: {
    requestId: string;
    confirmation: ExternalQuestionConfirmation;
    conceptCandidates: ExternalQuestionConceptCandidate[];
    depth: "direction" | "steps" | "complete";
  }): Promise<never> {
    throw new ExternalQuestionAiError(
      "UPSTREAM_UNAVAILABLE",
      503,
      false,
      "AI 讲题服务尚未配置。",
    );
  }
}

export interface ExternalQuestionCreateResult {
  kind: "upload";
  externalQuestionId: string;
  idempotencyReplayed: boolean;
}

export interface ExternalQuestionRecognitionResult {
  kind: "recognition";
  externalQuestionId: string;
  status: "recognition_failed" | "needs_better_image" | "unsupported" | "recognized";
  idempotencyReplayed: boolean;
}

export interface ExternalQuestionConfirmationResult {
  kind: "confirmation";
  externalQuestionId: string;
  contentRevision: number;
  changed: boolean;
  idempotencyReplayed: boolean;
}

export interface ExternalQuestionSaveResult {
  kind: "save";
  externalQuestionId: string;
  savedAt: string;
  idempotencyReplayed: boolean;
}

export interface ExternalQuestionExplanationResult {
  kind: "explanation";
  externalQuestionId: string;
  explanation: StoredExternalQuestionExplanation;
  idempotencyReplayed: boolean;
}

export interface ExternalQuestionDeleteResult {
  kind: "delete";
  externalQuestionId: string;
  deleted: true;
  cleanupRef: ExternalQuestionCleanupRef | null;
  idempotencyReplayed: boolean;
}

export interface ExternalQuestionRepository {
  findRecognitionReplay(input: {
    userId: string;
    externalQuestionId: string;
    idempotencyKey: string;
  }): Promise<ExternalQuestionRecognitionResult | null>;
  findExplanationReplay(input: {
    userId: string;
    externalQuestionId: string;
    contentRevision: number;
    depth: "direction" | "steps" | "complete";
    idempotencyKey: string;
  }): Promise<ExternalQuestionExplanationResult | null>;
  createTemporary(input: {
    userId: string;
    image: ExternalQuestionImageRecord;
    idempotencyKey: string;
    requestFingerprint: string;
    now: Date;
    expiresAt: Date;
  }): Promise<ExternalQuestionCreateResult>;
  recordRecognition(input: {
    userId: string;
    externalQuestionId: string;
    status: ExternalQuestionRecognitionResult["status"];
    recognition: ExternalQuestionRecognition | null;
    modelTrace: ExternalQuestionModelTrace | null;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionRecognitionResult>;
  confirm(input: {
    userId: string;
    externalQuestionId: string;
    confirmation: ExternalQuestionConfirmation;
    conceptCandidates: ExternalQuestionConceptCandidate[];
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionConfirmationResult>;
  save(input: {
    userId: string;
    externalQuestionId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionSaveResult>;
  storeExplanation(input: {
    userId: string;
    externalQuestionId: string;
    expectedContentRevision: number;
    explanation: ExternalQuestionExplanation;
    conceptIds: string[];
    modelTrace: ExternalQuestionModelTrace | null;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionExplanationResult>;
  getOwned(userId: string, externalQuestionId: string, now: Date): Promise<StoredExternalQuestion>;
  listOwned(userId: string, now: Date): Promise<StoredExternalQuestion[]>;
  markDeleted(input: {
    userId: string;
    externalQuestionId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionDeleteResult>;
  findCleanupBatch(now: Date, limit: number): Promise<ExternalQuestionCleanupRef[]>;
  finalizeCleanup(input: ExternalQuestionCleanupRef & { now: Date }): Promise<boolean>;
  releaseCleanup(input: ExternalQuestionCleanupRef): Promise<boolean>;
}
