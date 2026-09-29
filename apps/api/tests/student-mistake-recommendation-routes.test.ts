import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { LocalAuthenticationService, PublicAccount } from "../src/services/auth/authentication.js";

const student: PublicAccount = {
  user_id: "student_001",
  username: "student_001",
  display_name: "演示学生",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  last_login_at: null,
};

const admin: PublicAccount = { ...student, user_id: "admin_001", roles: ["admin"] };

const recommendation = {
  mistake_id: "mistake_001",
  course_id: "course_408_ds",
  course_title: "数据结构",
  question_id: "question_001",
  question_number: 12,
  concept_id: "ds_c02_02",
  concept_title: "顺序表的存储表示",
  priority_score: 82,
  algorithm_version: "evidence_weighted_v1",
  next_review_at: "2026-08-16T08:00:00.000Z",
  due_status: "due",
  evidence_level: "limited",
  reason_lines: ["已到复习时间", "核心知识点"],
  evidence_refs: ["mistake:mistake_001", "concept:ds_c02_02"],
  practice_href: "/student/practice?subject=%E6%95%B0%E6% 据结构&concept_id=ds_c02_02",
};

function platformAccess() {
  return {
    async getActor(userId: string) {
      const account = userId === admin.user_id ? admin : student;
      return {
        user: {
          user_id: account.user_id,
          display_name: account.display_name,
          account_status: account.account_status,
          auth_source: account.auth_source,
          created_at: account.created_at,
          updated_at: account.updated_at,
        },
        roles: account.roles,
      };
    },
    async isCourseAssigned() { return true; },
  };
}

describe("student mistake recommendation routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("lists only the current student's safe recommendation DTO", async () => {
    const listRecommendations = vi.fn(async (userId: string, filter: unknown) => {
      expect(userId).toBe(student.user_id);
      expect(filter).toEqual({ courseId: "course_408_ds", limit: 3 });
      return {
        algorithm_version: "evidence_weighted_v1" as const,
        generated_at: "2026-08-16T08:00:00.000Z",
        items: [recommendation],
      };
    });
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      mistakeRecommendation: { listRecommendations },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/mistake-recommendations?course_id=course_408_ds&limit=3",
      headers: { "x-dev-user-id": student.user_id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(JSON.stringify(response.json())).not.toMatch(/correct_option|answer_key|password|session|user_id/iu);
    expect(listRecommendations).toHaveBeenCalledOnce();
  });

  it("rejects invalid limits before touching the recommendation service", async () => {
    const listRecommendations = vi.fn();
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      mistakeRecommendation: { listRecommendations },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/mistake-recommendations?limit=0",
      headers: { "x-dev-user-id": student.user_id },
    });

    expect(response.statusCode).toBe(400);
    expect(listRecommendations).not.toHaveBeenCalled();
  });

  it("enforces authentication and student RBAC", async () => {
    const authentication = {
      async resolveSession(token: string) {
        if (token === "student-session") return { account: student };
        if (token === "admin-session") return { account: admin };
        return null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      allowLocalDevAuth: false,
      platformAccess: platformAccess(),
      mistakeRecommendation: { async listRecommendations() { return { algorithm_version: "evidence_weighted_v1", generated_at: "2026-08-16T08:00:00.000Z", items: [] }; } },
    } as never);

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/student/mistake-recommendations",
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/student/mistake-recommendations",
      headers: { cookie: "xuetu_session=admin-session" },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });

  it("returns an empty reliable queue without inventing an item", async () => {
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      mistakeRecommendation: {
        async listRecommendations() {
          return {
            algorithm_version: "evidence_weighted_v1",
            generated_at: "2026-08-16T08:00:00.000Z",
            items: [],
          };
        },
      },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/mistake-recommendations",
      headers: { "x-dev-user-id": student.user_id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([]);
  });
});
