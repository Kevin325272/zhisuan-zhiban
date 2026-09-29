import {
  programmingExperimentAttemptRecordSchema,
  programmingExperimentHistorySchema,
  type ProgrammingExperimentAttemptRecord,
  type ProgrammingExperimentHistory,
} from "@xuetu/contracts";

import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";

interface AttemptRow {
  attempt_id: string;
  experiment_id: string;
  course_id: string;
  concept_id: string;
  task_id: string;
  language: "cpp";
  source_code: string;
  result_payload: unknown;
  diagnosis_payload: unknown;
  created_at: Date | string;
}

export interface SaveProgrammingExperimentAttempt {
  userId: string;
  idempotencyKey: string;
  record: ProgrammingExperimentAttemptRecord;
}

export interface ProgrammingExperimentRepository {
  listAttempts(userId: string, experimentId: string, limit: number): Promise<ProgrammingExperimentHistory>;
  findIdempotent(
    userId: string,
    experimentId: string,
    idempotencyKey: string,
  ): Promise<ProgrammingExperimentAttemptRecord | null>;
  saveAttempt(input: SaveProgrammingExperimentAttempt): Promise<ProgrammingExperimentAttemptRecord>;
}

function jsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAttempt(row: AttemptRow) {
  return programmingExperimentAttemptRecordSchema.parse({
    attempt_id: row.attempt_id,
    experiment_id: row.experiment_id,
    course_id: row.course_id,
    concept_id: row.concept_id,
    task_id: row.task_id,
    language: row.language,
    source: row.source_code,
    result: jsonValue(row.result_payload),
    diagnosis: jsonValue(row.diagnosis_payload),
    created_at: iso(row.created_at),
  });
}

async function selectIdempotent(
  client: Pick<SqlClient, "query">,
  userId: string,
  experimentId: string,
  idempotencyKey: string,
) {
  const found = await client.query<AttemptRow>(
    `SELECT attempt_id, experiment_id, course_id, concept_id, task_id,
            language, source_code, result_payload, diagnosis_payload, created_at
     FROM programming_experiment_attempts
     WHERE user_id = $1 AND experiment_id = $2 AND idempotency_key = $3
     LIMIT 1`,
    [userId, experimentId, idempotencyKey],
  );
  return found.rows[0] ? mapAttempt(found.rows[0]) : null;
}

export class PostgresProgrammingExperimentRepository implements ProgrammingExperimentRepository {
  constructor(private readonly pool: SqlQueryablePool) {}

  async listAttempts(
    userId: string,
    experimentId: string,
    limit: number,
  ): Promise<ProgrammingExperimentHistory> {
    const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
    const [count, attempts] = await Promise.all([
      this.pool.query<{ total: number | string }>(
        `SELECT COUNT(*)::int AS total
         FROM programming_experiment_attempts
         WHERE user_id = $1 AND experiment_id = $2`,
        [userId, experimentId],
      ),
      this.pool.query<AttemptRow>(
        `SELECT attempt_id, experiment_id, course_id, concept_id, task_id,
                language, source_code, result_payload, diagnosis_payload, created_at
         FROM programming_experiment_attempts
         WHERE user_id = $1 AND experiment_id = $2
         ORDER BY created_at DESC, attempt_id DESC
         LIMIT $3`,
        [userId, experimentId, boundedLimit],
      ),
    ]);
    return programmingExperimentHistorySchema.parse({
      items: attempts.rows.map(mapAttempt),
      total: Number(count.rows[0]?.total ?? 0),
    });
  }

  async findIdempotent(
    userId: string,
    experimentId: string,
    idempotencyKey: string,
  ) {
    return selectIdempotent(this.pool as Pick<SqlClient, "query">, userId, experimentId, idempotencyKey);
  }

  async saveAttempt(input: SaveProgrammingExperimentAttempt) {
    const record = programmingExperimentAttemptRecordSchema.parse(input.record);
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query<{ attempt_id: string }>(
        `INSERT INTO programming_experiment_attempts(
           attempt_id, user_id, course_id, concept_id, experiment_id, task_id,
           idempotency_key, language, source_code, result_status, execution_mode,
           evaluator_label, passed_count, total_count, result_payload,
           diagnosis_payload, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15::jsonb, $16::jsonb, $17::timestamptz
         )
         ON CONFLICT (user_id, experiment_id, idempotency_key) DO NOTHING
         RETURNING attempt_id`,
        [
          record.attempt_id,
          input.userId,
          record.course_id,
          record.concept_id,
          record.experiment_id,
          record.task_id,
          input.idempotencyKey,
          record.language,
          record.source,
          record.result.status,
          record.result.execution_mode,
          record.result.evaluator_label,
          record.result.passed_count,
          record.result.total_count,
          JSON.stringify(record.result),
          JSON.stringify(record.diagnosis),
          record.created_at,
        ],
      );
      if (!inserted.rowCount) {
        const existing = await selectIdempotent(
          client,
          input.userId,
          record.experiment_id,
          input.idempotencyKey,
        );
        if (existing) return existing;
        throw new Error("Programming experiment idempotency conflict could not be resolved.");
      }

      await client.query(
        `INSERT INTO programming_experiment_evidence(
           evidence_id, attempt_id, user_id, course_id, concept_id, outcome,
           evidence_payload, eligible_for_learning_state_update, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)`,
        [
          `prog_evidence_${record.attempt_id}`,
          record.attempt_id,
          input.userId,
          record.course_id,
          record.concept_id,
          record.diagnosis.status === "passed" ? "passed" : "needs_revision",
          JSON.stringify({
            experiment_id: record.experiment_id,
            task_id: record.task_id,
            evaluator_label: record.result.evaluator_label,
            passed_count: record.result.passed_count,
            total_count: record.result.total_count,
            diagnosis: record.diagnosis,
          }),
          true,
          record.created_at,
        ],
      );
      return record;
    });
  }
}
