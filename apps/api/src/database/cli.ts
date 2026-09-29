import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SqlQueryablePool } from "./client.js";
import { createPostgresPool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedDevelopmentPlatform } from "./seed-development-platform.js";
import { seedCourseContent } from "./seed-course-content.js";
import { seedQuestionBank } from "./seed-question-bank.js";
import { seedExamPapers } from "./seed-exam-papers.js";
import { readDatabaseConfig } from "../config/database.js";
import { readPastExamConfig } from "../config/past-exams.js";
import { loadLocalEnvironment } from "../config/local-env.js";
import { loadQuestionBankDirectory } from "../services/question-bank/question-bank-source.js";
import { loadCourseContentSource } from "../services/course-content/course-content-source.js";
import { loadExamPaperArchive } from "../services/exam-papers/exam-paper-source.js";
import { load408CourseSourceArchive } from "../services/course-source-layer/408-course-source.js";
import { seed408SourceLayer } from "./seed-408-source-layer.js";
import { seedDataStructuresCurriculum } from "./seed-data-structures-curriculum.js";
import { seedOperatingSystemsCurriculum } from "./seed-operating-systems-curriculum.js";
import { seedComputerNetworksCurriculum } from "./seed-computer-networks-curriculum.js";
import { seedConceptPracticeLinks } from "./seed-concept-practice-links.js";
import { seedAuthentication } from "./seed-authentication.js";
import { seedOnboardingDiagnosticQuestions } from "./seed-onboarding-diagnostic.js";
import { seedAdmissions } from "./seed-admissions.js";
import { seedCourseVideos } from "./seed-course-videos.js";
import { seedPilotStudy } from "./seed-pilot-study.js";
import { seedPreDefenseDemoRoster } from "./seed-pre-defense-demo-roster.js";
import { seedCommunityDemo } from "./seed-community-demo.js";
import { ScryptPasswordHasher } from "../services/auth/password-hasher.js";
import { loadAdmissionsSource } from "../services/admissions/admissions-source.js";
import { loadCourseVideoSourceArchive } from "../services/course-videos/video-source.js";
import { seedLearningProbeDemo } from "./seed-learning-probe.js";

const defaultDataDirectory = fileURLToPath(
  new URL("../../../../data/question-bank-408/raw/408_json_data/", import.meta.url),
);
const defaultManifestPath = fileURLToPath(
  new URL("../../../../data/question-bank-408/manifest.json", import.meta.url),
);
const defaultCourseContentDirectory = fileURLToPath(
  new URL("../../../../data/course-materials/computer-organization/", import.meta.url),
);
const defaultExamPaperManifestPath = fileURLToPath(
  new URL("../../../../data/self-authored-exams/manifest.json", import.meta.url),
);
const defaultExamPaperArchivePath = fileURLToPath(
  new URL("../../../../data/self-authored-exams/raw/自命题试卷.zip", import.meta.url),
);
const default408SourceDirectory = fileURLToPath(
  new URL("../../../../data/course-materials/408-three-courses/", import.meta.url),
);
const default408SourceManifestPath = join(default408SourceDirectory, "manifest.json");
const default408SourceArchivePath = join(default408SourceDirectory, "raw", "output.zip");
const defaultAdmissionsSourceDirectory = fileURLToPath(
  new URL("../../../../data/admissions/retest-lines/", import.meta.url),
);
const defaultCourseVideoSourceDirectory = fileURLToPath(
  new URL("../../../../data/course-materials/408-video-links/", import.meta.url),
);
const defaultCourseVideoArchivePath = join(
  defaultCourseVideoSourceDirectory,
  "raw",
  "408四科视频网址(1).zip",
);
const defaultCourseVideoManifestPath = join(defaultCourseVideoSourceDirectory, "manifest.json");
const defaultCourseVideoCuratedLinksPath = join(
  defaultCourseVideoSourceDirectory,
  "curated",
  "concept-video-links.json",
);

interface QuestionBankManifest {
  archive_sha256: string;
  verified_counts: {
    years: number;
    questions: number;
    choice: number;
    subjective: number;
  };
}

interface ExamPaperManifest {
  archive_file: string;
  archive_bytes: number;
  archive_sha256: string;
  verified_counts: {
    papers: number;
    pages: number;
    schools: number;
    years: number;
    scans: number;
    text_layer: number;
  };
}

function loadManifest(): QuestionBankManifest {
  return JSON.parse(readFileSync(defaultManifestPath, "utf8")) as QuestionBankManifest;
}

function loadExamPaperManifest(): ExamPaperManifest {
  return JSON.parse(readFileSync(defaultExamPaperManifestPath, "utf8")) as ExamPaperManifest;
}

interface ThreeCourseSourceManifest {
  dataset_id: string;
  archive_file: string;
  archive_sha256: string;
  expected: {
    courses: number;
    chunks: number;
    figure_assets: number;
    figure_relations: number;
    image_pairs_available: number;
    figures_needing_human_review: number;
  };
}

function load408SourceManifest(): ThreeCourseSourceManifest {
  const parsed = JSON.parse(readFileSync(default408SourceManifestPath, "utf8")) as ThreeCourseSourceManifest;
  if (!parsed.archive_sha256 || !parsed.archive_file || !parsed.expected) {
    throw new Error("408 source manifest is incomplete.");
  }
  return parsed;
}

async function loadVerified408Source() {
  const manifest = load408SourceManifest();
  const archivePath = process.env.COURSE_408_SOURCE_ARCHIVE_PATH?.trim() || default408SourceArchivePath;
  const source = await load408CourseSourceArchive({
    archivePath,
    expectedArchiveSha256: manifest.archive_sha256,
  });
  const expected = manifest.expected;
  if (
    source.counts.courses !== expected.courses
    || source.counts.chunks !== expected.chunks
    || source.counts.figures !== expected.figure_assets
    || source.counts.relations !== expected.figure_relations
    || source.counts.displayableFigures !== expected.image_pairs_available
    || source.counts.needsHumanReviewFigures !== expected.figures_needing_human_review
  ) {
    throw new Error("408 source counts do not match the tracked manifest.");
  }
  return source;
}

async function loadVerifiedCourseVideoSource() {
  return loadCourseVideoSourceArchive({
    archivePath: process.env.COURSE_VIDEO_ARCHIVE_PATH?.trim() || defaultCourseVideoArchivePath,
    manifestPath: defaultCourseVideoManifestPath,
    curatedLinksPath: defaultCourseVideoCuratedLinksPath,
  });
}

async function loadVerifiedExamPaperSource() {
  const manifest = loadExamPaperManifest();
  const archivePath =
    process.env.EXAM_PAPER_ARCHIVE_PATH?.trim() || defaultExamPaperArchivePath;
  const source = await loadExamPaperArchive({
    archivePath,
    expectedArchiveSha256: manifest.archive_sha256,
  });
  if (
    source.counts.papers !== manifest.verified_counts.papers ||
    source.counts.pages !== manifest.verified_counts.pages ||
    source.counts.scans !== manifest.verified_counts.scans ||
    source.counts.textLayer !== manifest.verified_counts.text_layer
  ) {
    throw new Error("Self-authored exam-paper source counts do not match the tracked manifest.");
  }
  return source;
}

async function loadVerifiedQuestionSource() {
  const manifest = loadManifest();
  const source = await loadQuestionBankDirectory(
    process.env.QUESTION_BANK_SOURCE_DIR?.trim() || defaultDataDirectory,
    { archiveSha256: manifest.archive_sha256 },
  );
  if (
    source.counts.years !== manifest.verified_counts.years ||
    source.counts.questions !== manifest.verified_counts.questions ||
    source.counts.choice !== manifest.verified_counts.choice ||
    source.counts.subjective !== manifest.verified_counts.subjective
  ) {
    throw new Error("Question-bank source counts do not match the tracked manifest.");
  }
  return source;
}

async function main() {
  loadLocalEnvironment();
  const command = process.argv[2];
  if (
    !command ||
    ![
      "validate-questions",
      "validate-course-content",
      "validate-exam-papers",
      "validate-408-source",
      "validate-course-videos",
      "migrate",
      "seed-platform",
      "seed-questions",
      "seed-course-content",
      "seed-exam-papers",
      "seed-408-source",
      "seed-course-videos",
      "seed-data-structures-curriculum",
      "seed-operating-systems-curriculum",
      "seed-computer-networks-curriculum",
      "seed-concept-practice-links",
      "seed-onboarding-diagnostic",
      "seed-admissions",
      "seed-pilot-study",
      "seed-demo-roster",
      "seed-community",
      "seed-learning-probe",
      "seed-auth",
      "setup",
      "check",
    ].includes(command)
  ) {
    throw new Error(
      "Usage: tsx src/database/cli.ts <validate-questions|validate-course-content|validate-exam-papers|validate-408-source|validate-course-videos|migrate|seed-platform|seed-auth|seed-questions|seed-course-content|seed-exam-papers|seed-408-source|seed-data-structures-curriculum|seed-operating-systems-curriculum|seed-computer-networks-curriculum|seed-course-videos|seed-concept-practice-links|seed-onboarding-diagnostic|seed-admissions|seed-pilot-study|seed-demo-roster|seed-community|seed-learning-probe|setup|check>",
    );
  }

  if (command === "validate-questions") {
    const source = await loadVerifiedQuestionSource();
    console.log(
      `Question-bank source verified: years=${source.counts.years}, questions=${source.counts.questions}, choice=${source.counts.choice}, subjective=${source.counts.subjective}, runtime=postgresql, json=import_only`,
    );
    return;
  }

  if (command === "validate-course-content") {
    const source = loadCourseContentSource(
      process.env.COURSE_CONTENT_SOURCE_DIR?.trim() || defaultCourseContentDirectory,
    );
    console.log(
      `Course-content source verified: knowledge=${source.knowledge.length}, qa=${source.qa.length}, training_reference=${source.trainingCount}, curriculum_chapters=${source.curriculumMap.chapters.length}, curriculum_concepts=${source.curriculumMap.chapters.flatMap((chapter) => chapter.modules.flatMap((module) => module.concepts)).length}, figure_catalog=${source.figureCatalog.length}, figure_assets=${source.figureAssets.length}, concept_figure_links=${source.conceptFigureLinks.length}, usage=${source.trainingUsage}, runtime=postgresql, json=import_only`,
    );
    return;
  }

  if (command === "validate-exam-papers") {
    const source = await loadVerifiedExamPaperSource();
    console.log(
      `Exam-paper source verified: papers=${source.counts.papers}, pages=${source.counts.pages}, scans=${source.counts.scans}, text_layer=${source.counts.textLayer}, failures=${source.failureCount}, runtime=postgresql, zip=import_only`,
    );
    return;
  }

  if (command === "validate-408-source") {
    const source = await loadVerified408Source();
    console.log(
      `408 source verified: courses=${source.counts.courses}, chunks=${source.counts.chunks}, figures=${source.counts.figures}, relations=${source.counts.relations}, images=${source.counts.displayableFigures}, needs_human_review=${source.counts.needsHumanReviewFigures}, usage=local_demo_only, curriculum=not_imported`,
    );
    return;
  }

  if (command === "validate-course-videos") {
    const source = await loadVerifiedCourseVideoSource();
    console.log(
      `Course-video source verified: json=${source.counts.jsonFiles}, series=${source.counts.series}, episodes=${source.counts.episodes}, subjects=${source.counts.subjects}, reviewed_links=${source.curatedLinks.filter((link) => link.reviewStatus === "approved").length}, platform=bilibili_external_links_only, usage=local_demo_only`,
    );
    return;
  }

  const config = readDatabaseConfig();
  const pool = createPostgresPool(config);
  const sqlPool: SqlQueryablePool = pool;
  try {
    if (command === "migrate" || command === "setup") {
      const applied = await runMigrations(sqlPool);
      console.log(`PostgreSQL migrations applied: ${applied.length}`);
    }
    if (command === "seed-platform" || command === "setup") {
      const result = await seedDevelopmentPlatform(sqlPool);
      console.log(
        `Development platform seed: users=${result.users}, roles=${result.roles}, courses=${result.courses}, memberships=${result.memberships}`,
      );
    }
    if (command === "seed-auth") {
      const initialAdminPassword = process.env.XUETU_INITIAL_ADMIN_PASSWORD?.trim();
      const legacyStudentPassword = process.env.XUETU_LEGACY_STUDENT_PASSWORD?.trim();
      if (!initialAdminPassword || !legacyStudentPassword) {
        throw new Error(
          "seed-auth requires XUETU_INITIAL_ADMIN_PASSWORD and XUETU_LEGACY_STUDENT_PASSWORD in the local environment; passwords are never printed.",
        );
      }
      const seeded = await seedAuthentication(sqlPool, new ScryptPasswordHasher(), {
        initialAdminPassword,
        legacyStudentPassword,
        syncDemoCredentials: process.env.XUETU_SYNC_DEMO_CREDENTIALS?.trim().toLowerCase() === "true",
      });
      console.log(`Authentication seed applied: accounts=${seeded.updated}, passwords=server_hash_only`);
    }
    if (command === "seed-questions" || command === "setup") {
      const source = await loadVerifiedQuestionSource();
      const pastExamConfig = readPastExamConfig();
      const seeded = await seedQuestionBank(sqlPool, source, {
        courseId: "course_408_001",
        allowLocalDemoPastExams: pastExamConfig.allowLocalDemoPastExams,
      });
      console.log(
        `Question-bank seed: batch=${seeded.importBatchId}, questions=${seeded.questionCount}`,
      );
    }
    if (command === "seed-course-content" || command === "setup") {
      const source = loadCourseContentSource(
        process.env.COURSE_CONTENT_SOURCE_DIR?.trim() || defaultCourseContentDirectory,
      );
      const seeded = await seedCourseContent(sqlPool, source);
      console.log(
        `Course-content seed: sources=${seeded.sources}, knowledge=${seeded.knowledgeChunks}, qa=${seeded.qaExamples}, training_reference=${seeded.trainingRecords}, curriculum_modules=${seeded.curriculumModules}, curriculum_concepts=${seeded.curriculumConcepts}, curriculum_sources=${seeded.curriculumSourceReferences}, figure_catalog=${seeded.figureCatalogEntries}, figure_assets=${seeded.figureAssets}, figure_references=${seeded.figureReferences}, concept_figure_links=${seeded.conceptFigureLinks}`,
      );
    }
    if (command === "seed-exam-papers" || command === "setup") {
      const source = await loadVerifiedExamPaperSource();
      const seeded = await seedExamPapers(sqlPool, source, {
        courseId: "course_408_001",
      });
      console.log(
        `Exam-paper seed: batch=${seeded.importBatchId}, papers=${seeded.paperCount}`,
      );
    }
    if (command === "seed-408-source" || command === "setup") {
      const source = await loadVerified408Source();
      const seeded = await seed408SourceLayer(sqlPool, source);
      console.log(
        `408 source seed: datasets=${seeded.datasets}, chunks=${seeded.chunks}, figures=${seeded.figures}, relations=${seeded.relations}, runtime=postgresql, curriculum=not_imported`,
      );
    }
    if (command === "seed-data-structures-curriculum" || command === "setup") {
      const seeded = await seedDataStructuresCurriculum(sqlPool);
      console.log(
        `Data-structures curriculum seed: source=${seeded.source}, chunks=${seeded.chunks}, modules=${seeded.modules}, concepts=${seeded.concepts}, source_references=${seeded.sourceReferences}, figure_links=${seeded.figureLinks}, runtime=postgresql, source=408-three-course-source-v1`,
      );
    }
    if (command === "seed-operating-systems-curriculum" || command === "setup") {
      const seeded = await seedOperatingSystemsCurriculum(sqlPool);
      console.log(
        `Operating-systems curriculum seed: source=${seeded.source}, chunks=${seeded.chunks}, modules=${seeded.modules}, concepts=${seeded.concepts}, source_references=${seeded.sourceReferences}, figure_links=${seeded.figureLinks}, runtime=postgresql, source=408-three-course-source-v1`,
      );
    }
    if (command === "seed-computer-networks-curriculum" || command === "setup") {
      const seeded = await seedComputerNetworksCurriculum(sqlPool);
      console.log(
        `Computer-networks curriculum seed: source=${seeded.source}, chunks=${seeded.chunks}, modules=${seeded.modules}, concepts=${seeded.concepts}, source_references=${seeded.sourceReferences}, figure_links=${seeded.figureLinks}, runtime=postgresql, source=408-three-course-source-v1`,
      );
    }
    if (command === "seed-course-videos" || command === "setup") {
      const source = await loadVerifiedCourseVideoSource();
      const seeded = await seedCourseVideos(sqlPool, source);
      console.log(
        `Course-video seed: batches=${seeded.batches}, series=${seeded.series}, episodes=${seeded.episodes}, concept_links=${seeded.conceptLinks}, platform=bilibili_external_links_only, usage=local_demo_only`,
      );
    }
    if (command === "seed-concept-practice-links" || command === "setup") {
      const seeded = await seedConceptPracticeLinks(sqlPool);
      console.log(`Concept practice links seed: active_links=${seeded.activeLinks}, rule=exact_question_tag/v1_exact_unique_tag, runtime=postgresql`);
    }
    if (command === "seed-pilot-study") {
      const seeded = await seedPilotStudy(sqlPool);
      console.log(`Pilot study seed: studies=${seeded.studies}, tasks=${seeded.tasks}, evidence=server_verified`);
    }
    if (command === "seed-onboarding-diagnostic" || command === "setup") {
      const seeded = await seedOnboardingDiagnosticQuestions(sqlPool);
      console.log(`Onboarding diagnostic seed: set=${seeded.setVersion}, questions=${seeded.questionCount}, practice_questions=${seeded.practiceQuestionCount}, grading=deterministic_choice`);
    }
    if (command === "seed-admissions" || command === "setup") {
      const source = loadAdmissionsSource(
        process.env.ADMISSIONS_SOURCE_DIR?.trim() || defaultAdmissionsSourceDirectory,
      );
      const seeded = await seedAdmissions(sqlPool, source);
      console.log(
        `Admissions seed: targets=${seeded.targets}, retest_lines=${seeded.lines}, usage=local_demo_only, review=pending_official_verification`,
      );
    }
    if (command === "seed-demo-roster" || command === "setup") {
      const seeded = await seedPreDefenseDemoRoster(sqlPool);
      console.log(
        `Pre-defense demo roster: classes=${seeded.classes}, students=${seeded.students}, teachers=${seeded.teachers}, memberships=${seeded.memberships}, progress=${seeded.progressSnapshots}, assignments=${seeded.assignments}, provenance=synthetic_demo`,
      );
    }
    if (command === "seed-community" || command === "setup") {
      const seeded = await seedCommunityDemo(sqlPool);
      console.log(
        `School community demo: posts=${seeded.posts}, replies=${seeded.replies}, likes=${seeded.likes}, provenance=sample`,
      );
    }
    if (command === "seed-learning-probe" || command === "setup") {
      const seeded = await seedLearningProbeDemo(sqlPool);
      console.log(
        `Learning probe demo: questions=${seeded.questions}, links=${seeded.links}, pairs=${seeded.pairs}, provenance=local_demo`,
      );
    }
    if (command === "check") {
      const result = await sqlPool.query<{
        database_name: string;
        user_count: string;
        course_count: string;
        question_count: string;
        attempt_count: string;
        knowledge_chunk_count: string;
        qa_example_count: string;
        figure_asset_count: string;
        figure_reference_count: string;
        figure_catalog_count: string;
        concept_figure_link_count: string;
        curriculum_module_count: string;
        curriculum_concept_count: string;
        curriculum_source_count: string;
        exam_paper_count: string;
        exam_paper_batch_count: string;
        source_dataset_count: string;
        source_chunk_count: string;
        source_figure_count: string;
        source_relation_count: string;
        admission_target_count: string;
        admission_retest_line_count: string;
        course_video_batch_count: string;
        course_video_series_count: string;
        course_video_episode_count: string;
        course_video_link_count: string;
      }>(`SELECT current_database() AS database_name,
                 (SELECT COUNT(*) FROM users)::text AS user_count,
                 (SELECT COUNT(*) FROM course_catalog_entries)::text AS course_count,
                 (SELECT COUNT(*) FROM questions)::text AS question_count,
                 (SELECT COUNT(*) FROM practice_attempts)::text AS attempt_count,
                 (SELECT COUNT(*) FROM course_content_chunks)::text AS knowledge_chunk_count,
                 (SELECT COUNT(*) FROM course_qa_examples)::text AS qa_example_count,
                 (SELECT COUNT(*) FROM course_figure_assets)::text AS figure_asset_count,
                 (SELECT COUNT(*) FROM course_figure_references)::text AS figure_reference_count,
                 (SELECT COUNT(*) FROM course_figure_catalog_entries)::text AS figure_catalog_count,
                 (SELECT COUNT(*) FROM course_concept_figures)::text AS concept_figure_link_count,
                 (SELECT COUNT(*) FROM course_learning_modules)::text AS curriculum_module_count,
                 (SELECT COUNT(*) FROM course_core_concepts)::text AS curriculum_concept_count,
                 (SELECT COUNT(*) FROM course_concept_sources)::text AS curriculum_source_count,
                 (SELECT COUNT(*) FROM exam_papers)::text AS exam_paper_count,
                 (SELECT COUNT(*) FROM exam_paper_import_batches)::text AS exam_paper_batch_count,
                 (SELECT COUNT(*) FROM course_source_datasets)::text AS source_dataset_count,
                 (SELECT COUNT(*) FROM course_source_chunks)::text AS source_chunk_count,
                 (SELECT COUNT(*) FROM course_source_figure_assets)::text AS source_figure_count,
                 (SELECT COUNT(*) FROM course_source_figure_relations)::text AS source_relation_count,
                 (SELECT COUNT(*) FROM admission_targets)::text AS admission_target_count,
                 (SELECT COUNT(*) FROM admission_retest_lines)::text AS admission_retest_line_count,
                 (SELECT COUNT(*) FROM course_video_import_batches)::text AS course_video_batch_count,
                 (SELECT COUNT(*) FROM course_video_series)::text AS course_video_series_count,
                 (SELECT COUNT(*) FROM course_video_episodes)::text AS course_video_episode_count,
                 (SELECT COUNT(*) FROM course_concept_video_links WHERE display_enabled = true AND review_status = 'approved')::text AS course_video_link_count`);
      const row = result.rows[0];
      if (!row) throw new Error("Database check returned no row.");
      console.log(
        `PostgreSQL ready: database=${row.database_name}, users=${row.user_count}, courses=${row.course_count}, questions=${row.question_count}, attempts=${row.attempt_count}, knowledge=${row.knowledge_chunk_count}, qa=${row.qa_example_count}, curriculum_modules=${row.curriculum_module_count}, curriculum_concepts=${row.curriculum_concept_count}, curriculum_sources=${row.curriculum_source_count}, figure_catalog=${row.figure_catalog_count}, figure_assets=${row.figure_asset_count}, figure_references=${row.figure_reference_count}, concept_figure_links=${row.concept_figure_link_count}, exam_papers=${row.exam_paper_count}, exam_batches=${row.exam_paper_batch_count}, source_datasets=${row.source_dataset_count}, source_chunks=${row.source_chunk_count}, source_figures=${row.source_figure_count}, source_relations=${row.source_relation_count}, admission_targets=${row.admission_target_count}, admission_retest_lines=${row.admission_retest_line_count}, video_batches=${row.course_video_batch_count}, video_series=${row.course_video_series_count}, video_episodes=${row.course_video_episode_count}, video_links=${row.course_video_link_count}`,
      );
    }
  } finally {
    await pool.end();
  }
}

await main();
