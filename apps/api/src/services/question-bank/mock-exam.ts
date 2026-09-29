import type {
  MockExamSession,
  MockExamStartRequest,
  MockExamSubmissionResult,
  MockExamSubmitRequest,
} from "@xuetu/contracts";

export interface MockExamSubmission extends MockExamSubmissionResult {
  idempotency_replayed?: boolean;
}

export interface MockExamService {
  readonly courseId: string;
  start(userId: string, request: MockExamStartRequest): Promise<MockExamSession>;
  submit(
    userId: string,
    sessionId: string,
    request: MockExamSubmitRequest,
    idempotencyKey: string,
  ): Promise<MockExamSubmission>;
}

export class MockExamError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 410 | 422;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 410 | 422,
  ) {
    super(message);
    this.name = "MockExamError";
    this.code = code;
    this.status = status;
  }
}
