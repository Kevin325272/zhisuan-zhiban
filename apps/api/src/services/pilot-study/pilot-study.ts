import type {
  AnswerSubmission,
  PilotConsentRequest,
  PilotFeedbackRequest,
  PilotManagementReport,
  PilotParticipant,
  PilotParticipantEnrollment,
  PilotReportParticipant,
  PilotStudentStudy,
  PilotTaskEvaluationResponse,
  PilotTask,
} from "@xuetu/contracts";
import type { SqlClient } from "../../database/client.js";
import type { QuestionEvaluationBundle } from "../question-bank/question-bank.js";

export const ACTIVE_PILOT_STUDY_ID = "pilot_408_queue_v1";

export type PilotStudyErrorCode =
  | "PILOT_NOT_ENROLLED"
  | "PILOT_STUDY_NOT_ACTIVE"
  | "PILOT_CONSENT_VERSION_MISMATCH"
  | "PILOT_CONSENT_REQUIRED"
  | "PILOT_TASK_NOT_FOUND"
  | "PILOT_TASK_SEQUENCE_INVALID"
  | "PILOT_TASK_NOT_STARTED"
  | "PILOT_EVIDENCE_NOT_FOUND"
  | "PILOT_TASKS_INCOMPLETE"
  | "PILOT_ACCOUNT_NOT_FOUND"
  | "PILOT_ACCOUNT_NOT_STUDENT"
  | "PILOT_PARTICIPANT_EXISTS"
  | "PILOT_FEEDBACK_ALREADY_SUBMITTED"
  | "PILOT_EVALUATION_NOT_CONFIGURED";

export class PilotStudyError extends Error {
  constructor(
    public readonly code: PilotStudyErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PilotStudyError";
  }
}

export interface PilotStudyService {
  getStudentStudy(userId: string): Promise<PilotStudentStudy>;
  enrollParticipant(
    adminUserId: string,
    input: PilotParticipantEnrollment,
  ): Promise<PilotParticipant>;
  recordConsent(userId: string, input: PilotConsentRequest): Promise<PilotStudentStudy>;
  startTask(userId: string, taskId: string): Promise<PilotStudentStudy>;
  completeTask(
    userId: string,
    taskId: string,
    input: { attempt_id?: string },
  ): Promise<PilotStudentStudy>;
  evaluateChoiceTask(
    userId: string,
    taskId: string,
    selectedOptionIds: string[],
    idempotencyKey: string,
  ): Promise<PilotTaskEvaluationResponse>;
  submitFeedback(userId: string, input: PilotFeedbackRequest): Promise<PilotStudentStudy>;
  getManagementReport(includeSynthetic?: boolean): Promise<PilotManagementReport>;
}

export type PilotChoiceEvaluator = {
  evaluateInTransaction(
    client: SqlClient,
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
  ): Promise<QuestionEvaluationBundle>;
};

export function redactPilotEvaluation(
  taskId: string,
  bundle: QuestionEvaluationBundle,
): PilotTaskEvaluationResponse {
  if (
    bundle.evaluation.grading_mode !== "deterministic_choice"
    || (bundle.evaluation.status !== "correct" && bundle.evaluation.status !== "incorrect")
    || bundle.evaluation.score === null
  ) {
    throw new PilotStudyError("PILOT_EVIDENCE_NOT_FOUND", "试用题目未返回确定性评测结果。");
  }
  return {
    task_id: taskId,
    attempt_id: bundle.attempt.attempt_id,
    question_id: bundle.attempt.question_id,
    outcome: bundle.evaluation.status,
    score: bundle.evaluation.score,
    grading_mode: "deterministic_choice",
    evidence_at: bundle.evaluation.created_at,
    task_completed: true,
  };
}

export type PilotTaskStatusInput = Omit<PilotTask, "status">;

export function derivePilotTaskStatuses(
  taskRows: PilotTaskStatusInput[],
  consentedAt: string | null,
): PilotTask[] {
  let precedingComplete = true;
  return [...taskRows]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((task) => {
      let status: PilotTask["status"] = "locked";
      if (task.completed_at && task.result) {
        status = "completed";
      } else if (consentedAt && precedingComplete && task.started_at) {
        status = "started";
      } else if (consentedAt && precedingComplete) {
        status = "ready";
      }
      if (!task.completed_at || !task.result) precedingComplete = false;
      return { ...task, status };
    });
}

export type PilotReportParticipantInput = PilotReportParticipant;

interface PilotReportBuildInput {
  study: PilotManagementReport["study"];
  generatedAt: string;
  participants: PilotReportParticipantInput[];
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(correct: number, total: number) {
  return total === 0 ? null : rounded((correct / total) * 100);
}

function stageOutcome(
  participant: PilotReportParticipantInput,
  stage: "baseline" | "transfer",
) : "correct" | "incorrect" | null {
  const result = participant.tasks.find((task) => task.stage === stage)?.result;
  return result?.grading_mode === "deterministic_choice"
    && (result.outcome === "correct" || result.outcome === "incorrect")
    ? result.outcome
    : null;
}

function completionMinutes(participant: PilotReportParticipantInput) {
  const startedAt = participant.tasks
    .map((task) => task.started_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const finalTaskCompletedAt = participant.tasks
    .map((task) => task.completed_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1);
  if (!startedAt || !finalTaskCompletedAt) return null;
  const milliseconds = Date.parse(finalTaskCompletedAt) - Date.parse(startedAt);
  return milliseconds >= 0 ? rounded(milliseconds / 60_000) : null;
}

export function buildPilotManagementReport(
  input: PilotReportBuildInput,
  includeSynthetic = false,
): PilotManagementReport {
  const real = input.participants.filter((item) => item.participant_kind === "real_trial");
  const synthetic = input.participants.filter(
    (item) => item.participant_kind === "synthetic_verification",
  );
  const paired = real
    .map((item) => ({
      baseline: stageOutcome(item, "baseline"),
      transfer: stageOutcome(item, "transfer"),
    }))
    .filter(
      (item): item is { baseline: "correct" | "incorrect"; transfer: "correct" | "incorrect" } =>
        item.baseline !== null && item.transfer !== null,
    );
  const baseline = paired.map((item) => item.baseline);
  const transfer = paired.map((item) => item.transfer);
  const baselineCorrect = baseline.filter((outcome) => outcome === "correct").length;
  const transferCorrect = transfer.filter((outcome) => outcome === "correct").length;
  const baselineRate = percentage(baselineCorrect, baseline.length);
  const transferRate = percentage(transferCorrect, transfer.length);
  const feedback = real.flatMap((item) => item.feedback ? [item.feedback] : []);
  const completionDurations = real
    .map(completionMinutes)
    .filter((value): value is number => value !== null);
  const confidenceBefore = real
    .map((item) => item.baseline_confidence)
    .filter((value): value is number => value !== null);

  return {
    study: input.study,
    generated_at: input.generatedAt,
    data_scope: includeSynthetic ? "real_and_synthetic" : "real_trial_only",
    claim_boundary: "small_sample_observational",
    summary: {
      real_participants: real.length,
      synthetic_participants: synthetic.length,
      consented_real_participants: real.filter((item) => item.consented_at).length,
      completed_real_participants: real.filter((item) => item.completed_at).length,
      baseline_evaluated_count: baseline.length,
      baseline_correct_count: baselineCorrect,
      transfer_evaluated_count: transfer.length,
      transfer_correct_count: transferCorrect,
      baseline_correct_rate: baselineRate,
      transfer_correct_rate: transferRate,
      observed_change_percentage_points:
        baselineRate === null || transferRate === null ? null : rounded(transferRate - baselineRate),
      average_completion_minutes: average(completionDurations),
      average_ease_of_use: average(feedback.map((item) => item.ease_of_use)),
      average_guidance_helpfulness: average(
        feedback.map((item) => item.guidance_helpfulness),
      ),
      average_confidence_before: average(confidenceBefore),
      average_confidence_after: average(feedback.map((item) => item.confidence_after)),
      average_confidence_change:
        feedback.length === 0
          ? null
          : average(real.flatMap((item) => item.feedback && item.baseline_confidence !== null
            ? [item.feedback.confidence_after - item.baseline_confidence]
            : [])),
      average_continued_use_intent: average(
        feedback.map((item) => item.continued_use_intent),
      ),
    },
    participants: (includeSynthetic ? input.participants : real)
      .slice()
      .sort((left, right) => left.participant_code.localeCompare(right.participant_code)),
  };
}

function spreadsheetSafe(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const protectedText = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/gu, '""')}"`;
}

export function serializePilotReportCsv(report: PilotManagementReport) {
  const lines = [
    ["claim_boundary", report.claim_boundary],
    ["data_scope", report.data_scope],
    ["generated_at", report.generated_at],
    [],
    [
      "participant_code",
      "role_label",
      "participant_kind",
      "consented_at",
      "baseline_confidence",
      "completed_at",
      "baseline_outcome",
      "transfer_outcome",
      "ease_of_use",
      "guidance_helpfulness",
      "confidence_after",
      "continued_use_intent",
      "open_feedback",
    ],
    ...report.participants.map((participant) => [
      participant.participant_code,
      participant.role_label,
      participant.participant_kind,
      participant.consented_at,
      participant.baseline_confidence,
      participant.completed_at,
      stageOutcome(participant, "baseline"),
      stageOutcome(participant, "transfer"),
      participant.feedback?.ease_of_use,
      participant.feedback?.guidance_helpfulness,
      participant.feedback?.confidence_after,
      participant.feedback?.continued_use_intent,
      participant.feedback?.open_feedback,
    ]),
  ];
  return `\uFEFF${lines.map((row) => row.map(spreadsheetSafe).join(",")).join("\r\n")}\r\n`;
}
