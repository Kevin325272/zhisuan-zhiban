import {
  DEFAULT_STUDENT_AI_PREFERENCES,
  studentAiPreferencesSchema,
  type StudentAiPreferences,
  type StudentAiPreferencesPatch,
} from "@xuetu/contracts";
import type { SqlQueryablePool } from "../database/client.js";

export interface StudentAiPreferencesStore {
  get(userId: string): Promise<StudentAiPreferences>;
  update(userId: string, patch: StudentAiPreferencesPatch): Promise<StudentAiPreferences>;
}

type PreferenceRow = Omit<StudentAiPreferences, "updated_at"> & { updated_at: Date | string };
const parseRow = (row: PreferenceRow) => studentAiPreferencesSchema.parse({
  ...row, updated_at: new Date(row.updated_at).toISOString(),
});

export class PostgresStudentAiPreferences implements StudentAiPreferencesStore {
  constructor(private readonly pool: SqlQueryablePool) {}

  async get(userId: string): Promise<StudentAiPreferences> {
    const result = await this.pool.query<PreferenceRow>(
      "SELECT collaboration_enabled, visual_explanations_enabled, updated_at FROM student_ai_preferences WHERE user_id = $1",
      [userId],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : { ...DEFAULT_STUDENT_AI_PREFERENCES };
  }

  async update(userId: string, patch: StudentAiPreferencesPatch): Promise<StudentAiPreferences> {
    // Update only supplied fields in one statement, including concurrent first writes.
    const result = await this.pool.query<PreferenceRow>(`
      INSERT INTO student_ai_preferences(user_id, collaboration_enabled, visual_explanations_enabled)
      VALUES ($1, COALESCE($2::boolean, true), COALESCE($3::boolean, true))
      ON CONFLICT (user_id) DO UPDATE SET
        collaboration_enabled = COALESCE($2::boolean, student_ai_preferences.collaboration_enabled),
        visual_explanations_enabled = COALESCE($3::boolean, student_ai_preferences.visual_explanations_enabled),
        updated_at = now()
      RETURNING collaboration_enabled, visual_explanations_enabled, updated_at`,
    [userId, patch.collaboration_enabled ?? null, patch.visual_explanations_enabled ?? null]);
    return parseRow(result.rows[0]!);
  }
}
