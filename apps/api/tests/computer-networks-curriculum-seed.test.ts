import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult, SqlQueryablePool } from "../src/database/client.js";
import { seedComputerNetworksCurriculum } from "../src/database/seed-computer-networks-curriculum.js";
import {
  flattenComputerNetworksConcepts,
  loadComputerNetworksCurriculum,
} from "../src/services/course-content/computer-networks-curriculum-source.js";

describe("computer networks curriculum seed", () => {
  it("validates network source rows and writes only the curated layer transactionally", async () => {
    const source = loadComputerNetworksCurriculum();
    const concepts = flattenComputerNetworksConcepts(source);
    const references = concepts.flatMap((concept) => concept.sources);
    const chunkIds = [...new Set(references.map((reference) => reference.chunk_id))];
    const chapterByChunk = new Map(source.chapters.flatMap((chapter) =>
      chapter.modules.flatMap((module) => module.concepts.flatMap((concept) =>
        concept.sources.map((reference) => [reference.chunk_id, chapter.source_chapter] as const),
      )),
    ));
    const figures = concepts.flatMap((concept) => {
      const figure = concept.figure_guidance?.primary;
      return figure ? [{
        figure_asset_id: figure.asset_id,
        source_chunk_id: figure.source_chunk_id,
        figure_no: figure.figure_label.replace(".", "-"),
        title: figure.caption,
        review_status: "machine_verified",
        image_available: true,
        confidence: "high",
      }] : [];
    });
    const statements: string[] = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        statements.push(sql);
        return { rows: [], rowCount: 1 };
      },
      release() { statements.push("RELEASE"); },
    };
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql.includes("FROM course_source_datasets")) {
          return { rows: [{
            dataset_id: "408-three-course-source-v1_course_408_cn",
            archive_sha256: source.source_archive_sha256,
            license_status: "unverified",
            usage_scope: "local_demo_only",
          }] as Row[], rowCount: 1 };
        }
        if (sql.includes("FROM course_source_chunks")) {
          return { rows: chunkIds.map((chunk_id, index) => ({
            chunk_id,
            source_item_id: chunk_id,
            chapter: chapterByChunk.get(chunk_id)!,
            printed_page: references.find((reference) => reference.chunk_id === chunk_id)!.print_page,
            content_text: `来源 ${chunk_id}`,
            ordinal: index,
          })) as Row[], rowCount: chunkIds.length };
        }
        if (sql.includes("FROM course_source_figure_relations")) {
          return { rows: figures as Row[], rowCount: figures.length };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() { return client; },
    };

    const result = await seedComputerNetworksCurriculum(
      pool,
      source,
      () => new Date("2026-08-02T00:00:00.000Z"),
    );

    expect(result.concepts).toBe(50);
    expect(result.figureLinks).toBe(figures.length);
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("COMMIT");
    expect(statements.some((sql) => sql.includes("course_source_concept_figures"))).toBe(true);
    expect(statements.some((sql) => sql.includes("course_core_concepts"))).toBe(true);
    expect(statements.some((sql) => sql.includes("DELETE FROM course_core_concepts"))).toBe(false);
    expect(statements.some((sql) => sql.includes("DELETE FROM course_learning_modules"))).toBe(false);
    expect(statements.some((sql) => sql.includes("DELETE FROM course_content_chunks"))).toBe(false);
    expect(statements.some((sql) => (
      sql.includes("INSERT INTO course_content_chunks") && sql.includes("ON CONFLICT (chunk_id) DO UPDATE")
    ))).toBe(true);
    expect(statements.some((sql) => (
      sql.includes("INSERT INTO course_learning_modules") && sql.includes("ON CONFLICT (module_id) DO UPDATE")
    ))).toBe(true);
    expect(statements.some((sql) => (
      sql.includes("INSERT INTO course_core_concepts") && sql.includes("ON CONFLICT (concept_id) DO UPDATE")
    ))).toBe(true);
    expect(statements.every((sql) => !sql.includes("course_408_os") && !sql.includes("course_408_ds"))).toBe(true);
  });
});
