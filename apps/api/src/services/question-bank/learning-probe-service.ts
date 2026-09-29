import type {
  LearningProbeDecisionRequest,
  LearningProbeEventRequest,
  LearningProbeOffer,
  LearningProbeResult,
  LearningProbeSession,
} from "@xuetu/contracts";

export interface LearningProbeService {
  offerForAttempt(userId: string, attemptId: string): Promise<LearningProbeOffer | null>;
  getOffer(userId: string, probeSessionId: string): Promise<LearningProbeOffer | null>;
  start(userId: string, probeSessionId: string): Promise<LearningProbeOffer | null>;
  skip(userId: string, probeSessionId: string): Promise<LearningProbeSession>;
  submit(
    userId: string,
    probeSessionId: string,
    input: LearningProbeEventRequest,
    idempotencyKey: string,
  ): Promise<LearningProbeResult & { idempotency_replayed?: boolean }>;
  getSession(userId: string, probeSessionId: string): Promise<LearningProbeSession | null>;
}

export class LearningProbeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409 | 422 | 503 = 409,
  ) {
    super(message);
    this.name = "LearningProbeError";
  }
}

export type LearningProbeDecision = LearningProbeDecisionRequest["decision"];
