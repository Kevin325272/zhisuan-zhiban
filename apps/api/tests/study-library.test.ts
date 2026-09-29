import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
  studyMapQuerySchema,
  memoryReviewSchema,
  type StudyQuestion,
} from "@xuetu/contracts";
import { buildStudyMap } from "../src/services/study-library/question-inventory.js";
import {
  memoryDay,
  scheduleMemoryCard,
} from "../src/services/study-library/memory-scheduler.js";
import { questionKeywordTopics } from "../src/services/study-library/question-keywords.js";
import { registerStudentStudyLibraryRoutes } from "../src/routes/student-study-library.js";
import type { StudentStudyLibrary } from "../src/services/study-library/student-study-library.js";
import type { LocalAuthenticationService } from "../src/services/auth/authentication.js";
const question = (
  id: string,
  year: number,
  status: StudyQuestion["status"],
  topic: string,
): StudyQuestion => ({
  id,
  year,
  status,
  number: 1,
  subject: "数据结构",
  type: "choice",
  source: "past_exam",
  excerpt: "x",
  topics: [{ id: topic, title: topic }],
  href: "/student/practice",
});
describe("study map shared inventory", () => {
  it("labels literal stem keywords separately from verified concepts and never reads answer text", () => {
    expect(questionKeywordTopics("计算机网络", "TCP 的拥塞窗口")).toEqual([
      { id: "keyword:计算机网络:TCP", title: "TCP", kind: "keyword" },
      { id: "keyword:计算机网络:拥塞控制", title: "拥塞控制", kind: "keyword" },
    ]);
    expect(questionKeywordTopics("数据结构", "TCP 字段")).toEqual([]);
    expect(questionKeywordTopics("计算机网络", "notTCPIdentifier")).toEqual([]);
  });
  const items = [
    question("a", 2020, "correct", "tree"),
    question("b", 2020, "unseen", "tree"),
    question("c", 2021, "incorrect", "array"),
  ];
  it("counts unique years and uses the identical filtered IDs for the grid, progress and frequency", () => {
    const all = buildStudyMap(items, studyMapQuerySchema.parse({}));
    expect(all.total).toBe(3);
    expect(all.attempted).toBe(2);
    expect(all.topics[0]).toEqual({
      id: "tree",
      title: "tree",
      count: 2,
      years: 1,
    });
    const filtered = buildStudyMap(
      items,
      studyMapQuerySchema.parse({ topic: "tree", status: "unseen" }),
    );
    expect(filtered.items.map((q) => q.id)).toEqual(["b"]);
    expect(filtered.total).toBe(1);
    expect(filtered.attempted).toBe(0);
    expect(filtered.topics[0]?.count).toBe(1);
  });
  it("has no match for unknown topics and cannot accept forged account parameters", () => {
    expect(
      buildStudyMap(items, studyMapQuerySchema.parse({ topic: "other" })).total,
    ).toBe(0);
    expect(studyMapQuerySchema.safeParse({ user_id: "victim" }).success).toBe(
      false,
    );
  });
});
describe("memory scheduling", () => {
  it("uses the same Shanghai day across the UTC midnight boundary", () => {
    expect(memoryDay(new Date("2026-09-10T15:59:59Z"))).toBe("2026-09-10");
    expect(memoryDay(new Date("2026-09-10T16:00:00Z"))).toBe("2026-09-11");
  });
  it("keeps forgotten new cards in today and graduates familiar cards to a later date", () => {
    const now = new Date("2026-09-10T04:00:00Z");
    const again = scheduleMemoryCard(null, "again", now),
      easy = scheduleMemoryCard(null, "easy", now);
    expect(again.due.getTime()).toBeGreaterThan(now.getTime());
    expect(again.completed).toBe(false);
    expect(easy.completed).toBe(true);
    expect(easy.state.reps).toBe(1);
    expect(
      scheduleMemoryCard(
        JSON.parse(JSON.stringify(easy.state)),
        "good",
        easy.due,
      ).state.reps,
    ).toBe(2);
  });
  it("rejects out of range ratings, unversioned and forged review requests", () => {
    expect(
      memoryReviewSchema.safeParse({
        card_id: "1",
        version: 0,
        rating: "mastered",
        day: "today",
        user_id: "someone",
      }).success,
    ).toBe(false);
  });
});
describe("study library authentication", () => {
  function setup() {
    const app = Fastify();
    const service = {
      map: vi.fn().mockResolvedValue({ items: [] }),
      review: vi.fn().mockResolvedValue({}),
      saveCard: vi.fn().mockResolvedValue({}),
    } as unknown as StudentStudyLibrary;
    const authentication = {
      resolveSession: async (token: string) =>
        ["student", "teacher"].includes(token)
          ? {
              account: {
                user_id: `owner-${token}`,
                roles: [token],
                must_change_password: false,
              },
            }
          : null,
    } as unknown as LocalAuthenticationService;
    registerStudentStudyLibraryRoutes(app, service, {
      authentication,
      allowLocalDevAuth: false,
    });
    return { app, service };
  }
  it.each([
    ["", 401],
    ["teacher", 403],
    ["invalid", 401],
  ])("rejects %s without querying data", async (token, status) => {
    const { app, service } = setup();
    try {
      const r = await app.inject({
        url: "/api/v1/student/study-library/map",
        headers: { cookie: `xuetu_session=${token}` },
      });
      expect(r.statusCode).toBe(status);
      expect(service.map).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("derives ownership from a session and rejects unexpected write fields", async () => {
    const { app, service } = setup(),
      headers = { cookie: "xuetu_session=student" };
    try {
      expect(
        (
          await app.inject({
            url: "/api/v1/student/study-library/map",
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(service.map).toHaveBeenCalledWith(
        "owner-student",
        studyMapQuerySchema.parse({}),
      );
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/student/study-library/cards/card1",
            headers,
            payload: {
              front: "a",
              back: "b",
              subject: "通用",
              version: 0,
              user_id: "victim",
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(service.saveCard).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
