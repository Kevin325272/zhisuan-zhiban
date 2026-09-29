import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

describe("student read API", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ enableLegacyDemoRoutes: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the demo student overview", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/overview",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contract_version: "0.1",
      data: {
        student: {
          user_id: "user_demo_001",
          display_name: "演示学生",
        },
        current_course: {
          course_id: "course_ds_001",
          progress_percent: 42,
        },
        recommended_node: {
          learning_node_id: "node_bfs_001",
          status: "in_progress",
        },
      },
    });
  });

  it("returns the data structures course map", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/courses/course_ds_001/map",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.recommended_node_id).toBe("node_bfs_001");
    expect(body.data.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          learning_node_id: "node_bfs_001",
          title: "广度优先遍历",
          mastery_percent: 62,
          evidence_count: 3,
          weakness_count: 2,
          source_count: 2,
          position: { x: 52, y: 54 },
        }),
      ]),
    );
    expect(body.data.edges).toContainEqual({
      from_node_id: "node_queue_001",
      to_node_id: "node_bfs_001",
      relation: "prerequisite",
    });
  });

  it("returns distinct BFS traces for wrong and fixed code", async () => {
    const wrongResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/trace?language=python&variant=visited-on-dequeue",
    });
    const fixedResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/trace?variant=visited-on-enqueue",
    });

    expect(wrongResponse.statusCode).toBe(200);
    expect(fixedResponse.statusCode).toBe(200);
    const wrongTrace = wrongResponse.json().data;
    const fixedTrace = fixedResponse.json().data;

    expect(wrongTrace).toMatchObject({ language: "python", file_name: "bfs.py" });
    expect(wrongTrace.source_code).toContain("def bfs");

    expect(wrongTrace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflict: expect.objectContaining({ code: "BFS_DUPLICATE_ENQUEUE" }),
        }),
      ]),
    );
    expect(
      fixedTrace.steps.every(
        (step: { conflict: unknown }) => step.conflict === null,
      ),
    ).toBe(true);

    const expectedOutput = [
      [],
      ["1"],
      ["1"],
      ["1", "2"],
      ["1", "2"],
      ["1", "2", "3"],
    ];
    expect(wrongTrace.steps.map((step: { output: string[] }) => step.output)).toEqual(
      expectedOutput,
    );
    expect(fixedTrace.steps.map((step: { output: string[] }) => step.output)).toEqual(
      expectedOutput,
    );

    for (const trace of [wrongTrace, fixedTrace]) {
      expect(
        trace.steps.filter((step: { prediction: unknown }) => step.prediction !== null),
      ).toHaveLength(5);
      expect(trace.steps.at(-1)?.prediction).toBeNull();
      for (const step of trace.steps.slice(0, -1)) {
        expect(
          step.prediction.options.some(
            (option: { option_id: string }) =>
              option.option_id === step.prediction.correct_option_id,
          ),
        ).toBe(true);
      }
    }
  });

  it("builds the visual trace from the submitted custom graph and start node", async () => {
    const customInput = encodeURIComponent("start=7\n7 8\n7 9\n8 9");
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/task_bfs_bug_001/trace?language=cpp&variant=visited-on-dequeue&custom_input=${customInput}`,
    });

    expect(response.statusCode).toBe(200);
    const trace = response.json().data;
    expect(trace.graph.nodes.map((node: { node_id: string }) => node.node_id)).toEqual([
      "7",
      "8",
      "9",
    ]);
    expect(trace.steps[0]).toMatchObject({
      current_node_id: "7",
      queue: ["7"],
    });
    expect(trace.steps.some((step: { queue: string[] }) => step.queue.filter((node) => node === "9").length > 1)).toBe(true);
  });

  it("rejects unsupported trace variants", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/trace?variant=unknown",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_TRACE_VARIANT");
  });

  it("returns the deterministic BFS code task", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      task_id: "task_bfs_bug_001",
      learning_node_id: "node_bfs_001",
      type: "code",
      allowed_hint_level: 2,
    });
  });

  it("returns a stable error envelope for missing resources", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/missing-task",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      contract_version: "0.1",
      error: {
        code: "RESOURCE_NOT_FOUND",
        retryable: false,
      },
    });
  });

  it("returns traceable metadata for a test knowledge-base chunk", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sources/csdn_119455799_chunk_0020",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      source_id: "csdn_119455799_chunk_0020",
      document_id: "csdn_119455799",
      author: "胖胖的懒羊羊",
      source_type: "test_fixture",
      knowledge_base_version: "test_ds_bfs_v1",
      viewer_url: "https://blog.csdn.net/qq_44867340/article/details/119455799",
    });
  });

  it("returns practice task summaries", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/practice/tasks?course_id=course_ds_001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({
      task_id: "task_bfs_bug_001",
      status: "in_progress",
      estimated_minutes: 18,
    });
  });

  it("returns an evidence-backed learning profile", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-profile?course_id=course_ds_001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      course_id: "course_ds_001",
      evidence_count: 9,
    });
    expect(response.json().data.dimensions).toHaveLength(3);
  });

  it("returns a six-dimension ability assessment", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/ability-assessment?course_id=course_ds_001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      student_id: "user_demo_001",
      major: "计算机科学与技术",
      overall_score: 68,
      confidence: 86,
      evidence_count: 27,
    });
    expect(response.json().data.dimensions).toHaveLength(6);
  });

  it("rejects an ability assessment for an unknown course", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/ability-assessment?course_id=course_unknown",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });
});
