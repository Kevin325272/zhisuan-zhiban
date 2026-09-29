import { Readable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import type {
  ExamPaperDetail,
  ExamPaperListResponse,
  ExamPaperManagementResponse,
  PlatformRole,
  PlatformUser,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import type {
  ExamPaperLibrary,
  OpenExamPaperPdf,
} from "../src/services/exam-papers/exam-paper-library.js";

const student: PlatformUser = {
  user_id: "user_student_001",
  display_name: "演示学生",
  account_status: "active",
  auth_source: "local_development",
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

const admin: PlatformUser = {
  user_id: "user_admin_001",
  display_name: "演示管理员",
  account_status: "active",
  auth_source: "local_development",
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

const summary = {
  exam_paper_id: "exam_c3d34e3115ef7c7e6372f3bc",
  university: "上海科技大学",
  year: 2022,
  subject: "991数据结构与算法",
  paper_type: "exam" as const,
  page_count: 6,
  content_mode: "text_layer" as const,
  official_source_url: "https://sist.shanghaitech.edu.cn/paper.pdf",
  has_answer_key: false as const,
  automatic_grading: false as const,
};

const detail: ExamPaperDetail = {
  ...summary,
  landing_page_url: "https://sist.shanghaitech.edu.cn/paper/index.htm",
  file_size_bytes: 794_412,
};

function service(overrides: Partial<ExamPaperLibrary> = {}): ExamPaperLibrary {
  const list: ExamPaperListResponse = {
    items: [summary],
    total: 1,
    limit: 20,
    offset: 0,
    facets: {
      universities: ["上海科技大学"],
      years: [2022],
      subjects: ["991数据结构与算法"],
      paper_types: ["exam"],
    },
  };
  const management: ExamPaperManagementResponse = {
    items: [
      {
        ...detail,
        course_id: "course_408_001",
        pdf_sha256: "c".repeat(64),
        archive_sha256: "a".repeat(64),
        license_status: "unverified",
        usage_scope: "local_demo_only",
        training_allowed: false,
        review_status: "unreviewed",
        reviewed_by: null,
        reviewed_at: null,
        updated_at: "2026-07-31T00:00:00.000Z",
      },
    ],
    total: 1,
    scan_count: 0,
    text_layer_count: 1,
    license_unverified_count: 1,
    data_scope: "stored_records_only",
  };
  return {
    async list() {
      return list;
    },
    async get() {
      return detail;
    },
    async openPdf(): Promise<OpenExamPaperPdf> {
      return {
        stream: Readable.from([Buffer.from("%PDF-1.4\n", "utf8")]),
        size: 9,
        fileName: "试卷.pdf",
      };
    },
    async listManagement() {
      return management;
    },
    ...overrides,
  };
}

function accessFor(roles: PlatformRole[], assigned = true): PlatformAccessService {
  return {
    async getActor(userId) {
      if (userId === student.user_id && roles.includes("student")) {
        return { user: student, roles };
      }
      if (userId === admin.user_id && roles.includes("admin")) {
        return { user: admin, roles };
      }
      return null;
    },
    async isCourseAssigned() {
      return assigned;
    },
  };
}

async function createApp(
  roles: PlatformRole[],
  options: { assigned?: boolean; library?: ExamPaperLibrary } = {},
): Promise<FastifyInstance> {
  return buildApp({
    logger: false,
    allowLocalDevAuth: true,
    platformAccess: accessFor(roles, options.assigned ?? true),
    examPapers: options.library ?? service(),
  });
}

describe("exam paper routes", () => {
  it("requires the explicit local student identity", async () => {
    const app = await createApp(["student"]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/exam-papers",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
    await app.close();
  });

  it("keeps all student exam-paper APIs closed without reading the archive", async () => {
    const calls = { list: 0, get: 0, openPdf: 0 };
    const app = await createApp(["student"], {
      library: service({
        async list() {
          calls.list += 1;
          throw new Error("student list must stay closed");
        },
        async get() {
          calls.get += 1;
          throw new Error("student detail must stay closed");
        },
        async openPdf() {
          calls.openPdf += 1;
          throw new Error("student PDF must stay closed");
        },
      }),
    });

    for (const url of [
      "/api/v1/exam-papers?year=2022&paper_type=exam",
      `/api/v1/exam-papers/${summary.exam_paper_id}`,
      `/api/v1/exam-papers/${summary.exam_paper_id}/file`,
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { "x-dev-user-id": student.user_id },
      });
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error, url).toMatchObject({
        code: "EXAM_PAPERS_NOT_OPEN",
        message: "资料暂未开放训练。",
        retryable: false,
      });
    }
    expect(calls).toEqual({ list: 0, get: 0, openPdf: 0 });
    await app.close();
  });

  it("blocks students from the management projection", async () => {
    const app = await createApp(["student"]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/exam-papers",
      headers: { "x-dev-user-id": student.user_id },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("returns provenance to an administrator", async () => {
    const adminApp = await createApp(["admin"]);
    const adminResponse = await adminApp.inject({
      method: "GET",
      url: "/api/v1/manage/exam-papers",
      headers: { "x-dev-user-id": admin.user_id },
    });
    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.json().data.items[0].pdf_sha256).toBe("c".repeat(64));
    await adminApp.close();
  });
});
