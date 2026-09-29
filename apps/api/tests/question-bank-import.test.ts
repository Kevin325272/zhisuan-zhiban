import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import {
  QuestionBankSourceError,
  loadQuestionBankDirectory,
} from "../src/services/question-bank/question-bank-source.js";
import { seedQuestionBank } from "../src/database/seed-question-bank.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzZAAAAAElFTkSuQmCC",
  "base64",
);
const onePixelPngDataUrl = `data:image/png;base64,${onePixelPng.toString("base64")}`;

function choiceQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: "2009-01",
    year: 2009,
    number: 1,
    subject: "数据结构",
    section: "选择题",
    type: "choice",
    multiple: false,
    question: "<p><font color=\"red\">以下哪项正确？</font></p><script>unsafe()</script>",
    question_html: "<p>以下哪项正确？</p>",
    options: { A: "<u><strong>选项 A</strong></u>", B: "选项 B" },
    option_html: { A: "<strong>选项 A</strong>", B: "选项 B" },
    answer: "A",
    answer_list: ["A"],
    explanation: "<p>答案为 A。</p>",
    solution: "",
    tags: ["线性表"],
    source_url: "https://www.csgraduates.com/study_methods/408quiz/2009/#1",
    question_images: [onePixelPngDataUrl],
    option_images: { A: [], B: [] },
    explanation_images: ["images/explanation.png"],
    solution_images: [],
    external_assets: [],
    ...overrides,
  };
}

function writeYear(root: string, year: number, questions: unknown[]) {
  const directory = join(root, String(year));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${year}.json`),
    JSON.stringify({
      schema_version: 1,
      format: "408-question-bank-year",
      year,
      source_url: `https://www.csgraduates.com/study_methods/408quiz/${year}/`,
      question_count: questions.length,
      choice_count: questions.filter(
        (question) => (question as { type?: string }).type === "choice",
      ).length,
      subjective_count: questions.filter(
        (question) => (question as { type?: string }).type === "subjective",
      ).length,
      questions,
    }),
    "utf8",
  );
}

function realQuestion(year: number, number: number): Record<string, unknown> {
  const sourceRoot = fileURLToPath(new URL(
    "../../../data/question-bank-408/raw/408_json_data/",
    import.meta.url,
  ));
  const document = JSON.parse(
    readFileSync(join(sourceRoot, String(year), `${year}.json`), "utf8"),
  ) as { questions: Array<Record<string, unknown>> };
  const question = document.questions.find((entry) => entry.number === number);
  if (!question) throw new Error(`Missing real question fixture: ${year}-${number}`);
  return question;
}

describe("408 JSON import source adapter", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createRoot() {
    const root = mkdtempSync(join(tmpdir(), "xuetu-408-source-"));
    directories.push(root);
    return root;
  }

  it("normalizes HTML-bearing source fields and preserves safe asset references only", async () => {
    const root = createRoot();
    writeYear(root, 2009, [choiceQuestion()]);
    mkdirSync(join(root, "2009", "images"), { recursive: true });
    writeFileSync(join(root, "2009", "images", "explanation.png"), onePixelPng);

    const source = await loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "a".repeat(64),
    });

    expect(source.counts).toEqual({ years: 1, questions: 1, choice: 1, subjective: 0 });
    expect(source.questions[0]?.question.question).toBe("以下哪项正确？");
    expect(source.questions[0]?.question.options[0]?.text).toBe("选项 A");
    expect(JSON.stringify(source.questions[0])).not.toContain("<script>");
    expect(JSON.stringify(source.questions[0])).not.toContain("question_html");
    expect(JSON.stringify(source.questions[0])).not.toContain("data:image/png;base64");
    expect(source.questions[0]?.allAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "question",
          reference_kind: "embedded_source",
          source_reference: expect.stringMatching(/^embedded:sha256:[a-f0-9]{64}$/u),
          availability: "authenticated_api",
        }),
        expect.objectContaining({
          role: "explanation",
          reference_kind: "local_file",
          source_reference: "2009/images/explanation.png",
          availability: "authenticated_api",
        }),
      ]),
    );
    expect(source.assetBlobs).toHaveLength(1);
    expect(source.assetBlobs[0]).toMatchObject({
      mimeType: "image/png",
      byteLength: onePixelPng.length,
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Buffer.from(source.assetBlobs[0]!.content)).toEqual(onePixelPng);
    expect(source.questions[0]?.assetLinks).toHaveLength(2);
    expect(new Set(source.questions[0]?.assetLinks.map((link) => link.contentSha256)).size).toBe(1);
  });

  it.each([
    { year: 2020, number: 7, width: 421, height: 240 },
    { year: 2011, number: 47, width: 1001, height: 1094 },
  ])(
    "renders the complete $year-$number question SVG as one stable PNG instead of image fragments",
    async ({ year, number, width, height }) => {
      const root = createRoot();
      writeYear(root, year, [realQuestion(year, number)]);

      const source = await loadQuestionBankDirectory(root, {
        expectedYears: [year],
        archiveSha256: "9".repeat(64),
      });
      const record = source.questions[0];
      const questionAssets = record?.allAssets.filter((asset) => asset.role === "question") ?? [];
      expect(questionAssets).toHaveLength(1);
      expect(questionAssets[0]).toMatchObject({
        mime_type: "image/png",
        reference_kind: "embedded_source",
        source_reference: expect.stringMatching(/^rendered-svg:sha256:[a-f0-9]{64}$/u),
      });

      const link = record?.assetLinks.find((entry) => entry.assetId === questionAssets[0]?.asset_id);
      const blob = source.assetBlobs.find((entry) => entry.contentSha256 === link?.contentSha256);
      expect(blob).toBeDefined();
      const metadata = await sharp(blob!.content).metadata();
      expect(metadata).toMatchObject({ format: "png", width, height });
    },
    30_000,
  );

  it("keeps sibling SVG diagrams as separate rendered assets", async () => {
    const root = createRoot();
    writeYear(root, 2009, [choiceQuestion({
      question_html: [
        `<svg width="100" height="40" viewBox="0 0 100 40"><rect x="1" y="1" width="98" height="38" fill="white" stroke="black" /></svg>`,
        `<svg width="120" height="50" viewBox="0 0 120 50"><ellipse cx="60" cy="25" rx="40" ry="20" fill="none" stroke="black" /></svg>`,
      ].join(""),
      question_images: [onePixelPngDataUrl, onePixelPngDataUrl, onePixelPngDataUrl],
      explanation_images: [],
    })]);

    const source = await loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "8".repeat(64),
    });
    const questionAssets = source.questions[0]?.allAssets.filter(
      (asset) => asset.role === "question",
    ) ?? [];
    expect(questionAssets).toHaveLength(2);
    const renderedDimensions = await Promise.all(questionAssets.map(async (asset) => {
      const link = source.questions[0]?.assetLinks.find((entry) => entry.assetId === asset.asset_id);
      const blob = source.assetBlobs.find((entry) => entry.contentSha256 === link?.contentSha256);
      return sharp(blob!.content).metadata();
    }));
    expect(renderedDimensions.map(({ width, height }) => [width, height])).toEqual([
      [100, 40],
      [120, 50],
    ]);
  });

  it("keeps repeated sibling SVG instances distinct while deduplicating their PNG blob", async () => {
    const root = createRoot();
    const repeatedSvg = `<svg width="100" height="40" viewBox="0 0 100 40"><path d="M0 20H100" stroke="black" /></svg>`;
    writeYear(root, 2009, [choiceQuestion({
      question_html: repeatedSvg.repeat(2),
      question_images: [],
      explanation_images: [],
    })]);

    const source = await loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "4".repeat(64),
    });
    const record = source.questions[0]!;
    const questionAssets = record.allAssets.filter((asset) => asset.role === "question");
    expect(questionAssets).toHaveLength(2);
    expect(new Set(questionAssets.map((asset) => asset.asset_id)).size).toBe(2);
    expect(new Set(record.assetLinks.map((link) => link.contentSha256)).size).toBe(1);
  });

  it("accepts a finite unitless SVG font size used by historical diagrams", async () => {
    const root = createRoot();
    writeYear(root, 2009, [choiceQuestion({
      question_html: `<svg width="100" height="40" viewBox="0 0 100 40"><text x="10" y="24" font-size="16">A</text></svg>`,
      question_images: [],
      explanation_images: [],
    })]);

    const source = await loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "6".repeat(64),
    });
    const questionAssets = source.questions[0]?.allAssets.filter(
      (asset) => asset.role === "question",
    ) ?? [];
    expect(questionAssets).toHaveLength(1);
  });

  it("accepts bounded em dimensions used by MathJax SVG diagrams", async () => {
    const root = createRoot();
    writeYear(root, 2009, [choiceQuestion({
      question_html: `<svg width=".667em" height="7.2em" viewBox="0 0 10 100"><rect width="0" height="0" /><path d="M0 0V100" stroke="black" /></svg>`,
      question_images: [],
      explanation_images: [],
    })]);

    const source = await loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "5".repeat(64),
    });
    expect(source.questions[0]?.allAssets.filter(
      (asset) => asset.role === "question",
    )).toHaveLength(1);
  });

  it.each([
    ["script", `<svg width="10" height="10"><script>unsafe()</script></svg>`],
    ["event handler", `<svg width="10" height="10" onload="unsafe()"><rect width="10" height="10" /></svg>`],
    ["external image", `<svg width="10" height="10"><image href="https://attacker.invalid/pixel.png" width="10" height="10" /></svg>`],
  ])("rejects unsafe SVG %s content before rendering", async (_label, questionHtml) => {
    const root = createRoot();
    writeYear(root, 2009, [choiceQuestion({
      question_html: questionHtml,
      question_images: [],
      explanation_images: [],
    })]);

    await expect(Promise.resolve().then(() => loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "7".repeat(64),
    }))).rejects.toThrow(/unsafe svg/iu);
  });

  it("rejects an unbounded number of SVG diagrams in one source field", async () => {
    const root = createRoot();
    const diagram = '<svg width="1" height="1"><rect width="1" height="1" fill="#000" /></svg>';
    writeYear(root, 2009, [choiceQuestion({
      question_html: Array.from({ length: 129 }, () => diagram).join(""),
      question_images: [],
      explanation_images: [],
    })]);

    await expect(
      loadQuestionBankDirectory(root, {
        expectedYears: [2009],
        archiveSha256: "9".repeat(64),
      }),
    ).rejects.toThrow("SVG diagram count exceeds");
  });

  it("rejects invalid answer keys, duplicate IDs, and escaping asset paths", async () => {
    const badAnswerRoot = createRoot();
    writeYear(badAnswerRoot, 2009, [choiceQuestion({ answer_list: ["Z"] })]);
    await expect(
      loadQuestionBankDirectory(badAnswerRoot, {
        expectedYears: [2009],
        archiveSha256: "b".repeat(64),
      }),
    ).rejects.toThrow(QuestionBankSourceError);

    const duplicateRoot = createRoot();
    writeYear(duplicateRoot, 2009, [choiceQuestion(), choiceQuestion()]);
    mkdirSync(join(duplicateRoot, "2009", "images"), { recursive: true });
    writeFileSync(join(duplicateRoot, "2009", "images", "explanation.png"), onePixelPng);
    await expect(
      loadQuestionBankDirectory(duplicateRoot, {
        expectedYears: [2009],
        archiveSha256: "c".repeat(64),
      }),
    ).rejects.toThrow("Duplicate question id");

    const escapingRoot = createRoot();
    writeYear(escapingRoot, 2009, [
      choiceQuestion({ explanation_images: ["../outside.png"] }),
    ]);
    await expect(
      loadQuestionBankDirectory(escapingRoot, {
        expectedYears: [2009],
        archiveSha256: "d".repeat(64),
      }),
    ).rejects.toThrow("Unsafe asset reference");

    const fakeImageRoot = createRoot();
    writeYear(fakeImageRoot, 2009, [
      choiceQuestion({ question_images: ["data:image/png;base64,aGVsbG8="] }),
    ]);
    await expect(
      loadQuestionBankDirectory(fakeImageRoot, {
        expectedYears: [2009],
        archiveSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("signature");

    const unsafeMimeRoot = createRoot();
    writeYear(unsafeMimeRoot, 2009, [
      choiceQuestion({ question_images: ["data:text/html;base64,PGgxPmJhZDwvaDE+"] }),
    ]);
    await expect(
      loadQuestionBankDirectory(unsafeMimeRoot, {
        expectedYears: [2009],
        archiveSha256: "1".repeat(64),
      }),
    ).rejects.toThrow("Unsupported question image MIME type");

    const missingLocalRoot = createRoot();
    writeYear(missingLocalRoot, 2009, [choiceQuestion()]);
    await expect(
      loadQuestionBankDirectory(missingLocalRoot, {
        expectedYears: [2009],
        archiveSha256: "2".repeat(64),
      }),
    ).rejects.toThrow("Unable to read local question image");
  });

  it("seeds the normalized source in one PostgreSQL transaction", async () => {
    const root = createRoot();
    writeYear(root, 2009, [choiceQuestion()]);
    mkdirSync(join(root, "2009", "images"), { recursive: true });
    writeFileSync(join(root, "2009", "images", "explanation.png"), onePixelPng);
    const source = await loadQuestionBankDirectory(root, {
      expectedYears: [2009],
      archiveSha256: "e".repeat(64),
    });

    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("RETURNING import_batch_id")) {
          return {
            rows: [{ import_batch_id: "import_408_001" } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {
        statements.push({ sql: "RELEASE" });
      },
    };
    const result = await seedQuestionBank(
      { async connect() { return client; } },
      source,
      {
        courseId: "course_408_001",
        allowLocalDemoPastExams: true,
        createId: () => "import_408_001",
        now: () => new Date("2026-08-24T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({ importBatchId: "import_408_001", questionCount: 1 });
    expect(statements.map((entry) => entry.sql)).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("INSERT INTO question_import_batches"),
        expect.stringContaining("INSERT INTO questions"),
        expect.stringContaining("INSERT INTO question_asset_blobs"),
        expect.stringContaining("INSERT INTO question_asset_links"),
        expect.stringContaining("INSERT INTO question_learning_metadata"),
        "COMMIT",
        "RELEASE",
      ]),
    );
    const metadataWrite = statements.find((entry) =>
      entry.sql.includes("INSERT INTO question_learning_metadata")
    );
    const questionWrite = statements.find((entry) =>
      entry.sql.includes("INSERT INTO questions")
    );
    expect(questionWrite?.parameters).toContain("approved");
    expect(questionWrite?.parameters).toContain(
      "结构与资源完整性已通过固定清单校验；仅限本地演示。",
    );
    expect(questionWrite?.sql).toContain("questions.review_status = 'unreviewed'");
    expect(questionWrite?.sql).not.toMatch(/questions\.review_status\s*=\s*EXCLUDED\.review_status/iu);
    expect(metadataWrite?.sql).not.toContain(
      "content_review_status = EXCLUDED.content_review_status",
    );
    expect(metadataWrite?.parameters).toEqual([
      "2009-01",
      2009,
      true,
      "demo_validated",
      "2026-08-24T00:00:00.000Z",
    ]);
    expect(metadataWrite?.sql).toContain("question_learning_metadata.content_review_status = 'pending_teacher_review'");
    expect(metadataWrite?.sql).toContain("EXCLUDED.content_review_status = 'demo_validated'");
    expect(JSON.stringify(statements)).not.toContain("question_html");
    expect(JSON.stringify(statements)).not.toContain("<script>");
    expect(JSON.stringify(statements)).not.toContain("data:image");
    const blobWrites = statements.filter((entry) =>
      entry.sql.includes("INSERT INTO question_asset_blobs")
    );
    expect(blobWrites).toHaveLength(1);
    const linkWrites = statements.filter((entry) =>
      entry.sql.includes("INSERT INTO question_asset_links")
    );
    expect(linkWrites).toHaveLength(2);
    const orphanCleanup = statements.find((entry) =>
      entry.sql.includes("DELETE FROM question_asset_blobs")
    );
    expect(orphanCleanup?.sql).toMatch(
      /NOT EXISTS[\s\S]+question_asset_links[\s\S]+content_sha256/iu,
    );
  });
});
