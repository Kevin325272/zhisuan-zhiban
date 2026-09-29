import { withTransaction, type SqlPool } from "./client.js";
import type { AdmissionsSource } from "../services/admissions/admissions-source.js";

export async function seedAdmissions(
  pool: SqlPool,
  source: AdmissionsSource,
): Promise<{ targets: number; lines: number }> {
  return withTransaction(pool, async (client) => {
    for (const target of source.targets) {
      await client.query(
        `INSERT INTO admission_targets(
           target_id, school, training_unit, program_code, program_name, study_mode,
           dataset_id, license_status, usage_scope, training_allowed, review_status,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
         ON CONFLICT (target_id) DO UPDATE SET
           school = EXCLUDED.school,
           training_unit = EXCLUDED.training_unit,
           program_code = EXCLUDED.program_code,
           program_name = EXCLUDED.program_name,
           study_mode = EXCLUDED.study_mode,
           dataset_id = EXCLUDED.dataset_id,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           training_allowed = EXCLUDED.training_allowed,
           review_status = EXCLUDED.review_status,
           updated_at = now()`,
        [
          target.target_id,
          target.school,
          target.training_unit,
          target.program_code,
          target.program_name,
          target.study_mode,
          source.manifest.dataset_id,
          source.manifest.license_status,
          source.manifest.usage_scope,
          source.manifest.training_allowed,
          source.manifest.review_status ?? "pending_official_verification",
        ],
      );
    }

    for (const line of source.lines) {
      await client.query(
        `INSERT INTO admission_retest_lines(
           line_id, target_id, year, retest_score, politics_score,
           foreign_language_score, business_course_1_score, business_course_2_score,
           direction, initial_subjects, subject_source_url, retest_source_url,
           source_domain, source_type, review_status, original_note, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())
         ON CONFLICT (line_id) DO UPDATE SET
           target_id = EXCLUDED.target_id,
           year = EXCLUDED.year,
           retest_score = EXCLUDED.retest_score,
           politics_score = EXCLUDED.politics_score,
           foreign_language_score = EXCLUDED.foreign_language_score,
           business_course_1_score = EXCLUDED.business_course_1_score,
           business_course_2_score = EXCLUDED.business_course_2_score,
           direction = EXCLUDED.direction,
           initial_subjects = EXCLUDED.initial_subjects,
           subject_source_url = EXCLUDED.subject_source_url,
           retest_source_url = EXCLUDED.retest_source_url,
           source_domain = EXCLUDED.source_domain,
           source_type = EXCLUDED.source_type,
           review_status = EXCLUDED.review_status,
           original_note = EXCLUDED.original_note,
           updated_at = now()`,
        [
          line.line_id,
          line.target_id,
          line.year,
          line.retest_score,
          line.subject_scores.politics,
          line.subject_scores.foreign_language,
          line.subject_scores.business_course_1,
          line.subject_scores.business_course_2,
          line.direction,
          line.initial_subjects,
          line.subject_source_url,
          line.retest_source_url,
          line.source_domain,
          line.source_type,
          line.review_status,
          line.original_note,
        ],
      );
    }

    return { targets: source.targets.length, lines: source.lines.length };
  });
}
