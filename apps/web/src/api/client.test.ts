import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import * as client from "./client";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ contract_version: "0.1", request_id: "req_test", data }),
  } as Response;
}

function choiceCompletionSettlement() {
  return {
    version: "challenge_settlement_v1" as const,
    task_type: "choice_practice" as const,
    course_id: "course_408_ds",
    course_title: "数据结构",
    concept_id: "ds_c01",
    concept_title: "算法复杂度",
    outcome: "correct" as const,
    result_title: "本关已完成",
    result_detail: "本次选择题已按题库标准答案完成确定性判分。",
    evidence_update: {
      added_count: 1,
      objective_total: 2,
      summary: "新增 1 次确定性选择题作答。",
    },
    profile_update: {
      kind: "practice_correct" as const,
      title: "算法复杂度新增一次正确作答",
      detail: "本次结果已计入画像，仍需后续证据观察是否稳定掌握。",
    },
    review_update: {
      status: "not_required" as const,
      mistake_id: null,
      next_review_at: null,
      summary: "本次正确作答未新增待复习记录。",
    },
    plan_progress: {
      tracked: true,
      completed_task_count: 1,
      total_task_count: 7,
      completion_percent: 14,
    },
    next_task: {
      task_id: "live_read_co_c01",
      task_type: "course_reading" as const,
      title: "继续组成原理课程学习",
      reason: "按当前七日路径继续下一项任务。",
      estimated_minutes: 20,
      href: "/student/courses/computer-organization",
      course_id: "course_408_co",
      concept_id: "co_c01",
    },
  };
}

describe("student redesign API client", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("loads practice task summaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        course: { course_id: "course_ds_001", title: "数据结构" },
        items: [{ task_id: "task_bfs_bug_001", title: "修复 BFS 重复入队问题" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const getPracticeTasks = (
      client as unknown as { getPracticeTasks: () => Promise<{ items: Array<{ task_id: string }> }> }
    ).getPracticeTasks;
    const result = await getPracticeTasks();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/practice/tasks?course_id=course_ds_001",
      expect.any(Object),
    );
    expect(result.items[0]?.task_id).toBe("task_bfs_bug_001");
  });

  it("loads the PostgreSQL-backed 408 course catalog with the server session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ courses: [], recommended_start: null }));
    vi.stubGlobal("fetch", fetchMock);

    await client.get408Courses();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/408/courses",
      expect.objectContaining({
        credentials: "same-origin",
      }),
    );
  });

  it("loads a filtered course video series page with encoded query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      course_slug: "data-structures",
      course_title: "数据结构",
      items: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getCourseVideoSeries("data-structures", {
      q: " 栈 & 队列 ",
      kind: "teaching",
      page: 2,
      pageSize: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/408/courses/data-structures/videos?q=%E6%A0%88+%26+%E9%98%9F%E5%88%97&kind=teaching&page=2&page_size=10",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("loads one encoded video series episode page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      course_slug: "data-structures",
      items: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getCourseVideoSeriesEpisodes(
      "data-structures",
      "course_video_series_BVTEST0",
      { page: 2, pageSize: 30 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/408/courses/data-structures/videos/course_video_series_BVTEST0/episodes?page=2&page_size=30",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("loads the evidence-backed student learning orchestration with the server session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      generated_at: "2026-08-12T06:49:25.213Z",
      source: "deterministic_evidence_rules",
      ai_status: "unavailable",
      current_task: { task_id: "live_mistake_001" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.getStudentLearningOrchestration();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/learning-orchestration",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result.current_task.task_id).toBe("live_mistake_001");
  });

  it("uses the optional session endpoint for anonymous auth initialization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ account: null }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getAuthSession({ optional: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/session?optional=1",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("uses cookie-authenticated care endpoints without browser-owned identity or evidence fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        kind: "invitation",
        preference_enabled: true,
        interaction_id: "care_001",
        signal_code: "rhythm_drop",
        greeting: "最近的学习节奏慢了一些，今天想怎么继续？",
        reason_summary: "最近一周完成学习任务的天数比此前少。",
        actions: ["continue", "lighten", "talk", "dismiss", "disable"],
        presented_at: "2026-08-21T08:00:00.000Z",
        expires_at: "2026-08-22T08:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        enabled: true,
        updated_at: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        action: "talk",
        idempotent: false,
        status: { kind: "none", preference_enabled: true },
        talk: {
          capability: "care",
          course_id: "course_408_ds",
          conversation_id: "care_001",
          fallback_step: {
            task_id: "task_ds_read",
            task_type: "course_reading",
            course_id: "course_408_ds",
            course_title: "数据结构",
            title: "回到上次阅读位置",
            detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
            estimated_minutes: 10,
            href: "/student/courses/data-structures",
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        enabled: false,
        updated_at: "2026-08-21T08:05:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getStudentCareStatus();
    await client.getStudentCarePreference();
    await client.respondToStudentCare("care_001", "talk");
    await client.updateStudentCarePreference(false);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/student/care",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/student/care/preferences",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/student/care/care_001/respond",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ action: "talk" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/student/care/preferences",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: JSON.stringify({ enabled: false }),
      }),
    );
    const outbound = fetchMock.mock.calls.map((call) => String(call[1]?.body ?? "")).join("\n");
    expect(outbound).not.toContain("user_id");
    expect(outbound).not.toContain("evidence");
    expect(outbound).not.toContain("score");
    expect(outbound).not.toContain("/student/");
  });

  it("activates and settles a student learning task through the internal API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: "live_practice_ds_c01", activated_at: "2026-08-13T08:00:00.000Z", idempotent: false }))
      .mockResolvedValueOnce(jsonResponse({
        task_id: "live_practice_ds_c01",
        completed_at: "2026-08-13T08:05:00.000Z",
        evidence_refs: ["evidence:e1"],
        idempotent: false,
        next_task_id: "live_read_co_c01",
        settlement: choiceCompletionSettlement(),
      }));
    vi.stubGlobal("fetch", fetchMock);

    const activate = (client as unknown as { activateStudentLearningTask: (taskId: string) => Promise<{ task_id: string }> }).activateStudentLearningTask;
    const complete = (client as unknown as { completeStudentLearningTask: (taskId: string) => Promise<{ next_task_id: string | null }> }).completeStudentLearningTask;
    await activate("live_practice_ds_c01");
    const settled = await complete("live_practice_ds_c01");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/student/learning-orchestration/activate");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ task_id: "live_practice_ds_c01" }) }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/student/learning-orchestration/complete");
    expect(settled.next_task_id).toBe("live_read_co_c01");
    expect(settled).toMatchObject({ settlement: { version: "challenge_settlement_v1" } });
  });

  it("searches, reads, selects and clears only the authenticated student's admissions target", async () => {
    const target = {
      target_id: "admission_target_001",
      school: "中国科学技术大学",
      training_unit: "计算机科学与技术学院",
      program_code: "081200",
      program_name: "计算机科学与技术",
      study_mode: "全日制",
      available_years: [2026],
      retest_lines: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ target: null, saved_at: null }))
      .mockResolvedValueOnce(jsonResponse({
        items: [target],
        total: 1,
        page: 2,
        page_size: 10,
        available_years: [2026, 2025, 2024],
        data_boundary: {
          scope: "retest_cutoff_information_only",
          notice: "请以院校官网当年公告为准。",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ target, saved_at: "2026-08-12T08:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ target: null, saved_at: null }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getStudentAdmissionsTarget();
    await client.searchStudentAdmissionsTargets({ q: "科大", year: 2026, page: 2, page_size: 10 });
    await client.selectStudentAdmissionsTarget(target.target_id);
    await client.clearStudentAdmissionsTarget();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/student/admissions/target",
      "/api/v1/student/admissions/targets?q=%E7%A7%91%E5%A4%A7&year=2026&page=2&page_size=10",
      "/api/v1/student/admissions/target",
      "/api/v1/student/admissions/target",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ target_id: target.target_id }),
      credentials: "same-origin",
    }));
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      method: "DELETE",
      credentials: "same-origin",
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id/iu);
  });

  it("loads traceable course knowledge and QA examples", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ course_slug: "computer-organization", items: [] }))
      .mockResolvedValueOnce(jsonResponse({
        course_id: "course_408_co",
        course_slug: "computer-organization",
        title: "课程知识地图",
        chapters: [],
      }))
      .mockResolvedValueOnce(jsonResponse({ course_slug: "computer-organization", items: [], total: 0, limit: 1, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse({ course_slug: "computer-organization", items: [], total: 0, limit: 3, offset: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getCourseChapters("computer-organization");
    await client.getCourseCurriculumMap("computer-organization");
    await client.getCourseKnowledge("computer-organization", {
      chapter: "1 计算机系统概论", limit: 1, offset: 0,
    });
    await client.getCourseQaExamples("computer-organization", { limit: 3, offset: 0 });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/408/courses/computer-organization/chapters",
      "/api/v1/408/courses/computer-organization/curriculum-map",
      "/api/v1/408/courses/computer-organization/knowledge?chapter=1+%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%B3%BB%E7%BB%9F%E6%A6%82%E8%AE%BA&limit=1&offset=0",
      "/api/v1/408/courses/computer-organization/qa-examples?limit=3&offset=0",
    ]);
  });

  it("loads reviewed external videos for one course concept", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      course_slug: "data-structures",
      concept_id: "ds_c01_01",
      external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getCourseConceptVideos("data-structures", "ds_c01_01");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/408/courses/data-structures/concepts/ds_c01_01/videos",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("reads and saves PostgreSQL course-reading progress with the student identity", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ progress: null }))
      .mockResolvedValueOnce(jsonResponse({
        course_slug: "computer-organization",
        chapter: "1 计算机系统概论",
        chunk_id: "co_chunk_k0013",
        chunk_offset: 1,
        paragraph_index: 3,
        source_expanded: true,
        updated_at: "2026-07-28T09:00:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const progressClient = client as unknown as {
      getCourseReadingProgress: (slug: string) => Promise<{ progress: unknown }>;
      saveCourseReadingProgress: (
        slug: string,
        update: {
          chapter: string;
          chunk_id: string;
          paragraph_index: number;
          source_expanded: boolean;
        },
        options?: { keepalive?: boolean },
      ) => Promise<unknown>;
    };

    await progressClient.getCourseReadingProgress("computer-organization");
    await progressClient.saveCourseReadingProgress(
      "computer-organization",
      {
        chapter: "1 计算机系统概论",
        chunk_id: "co_chunk_k0013",
        paragraph_index: 3,
        source_expanded: true,
      },
      { keepalive: true },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/408/courses/computer-organization/reading-progress",
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/v1/408/courses/computer-organization/reading-progress",
      expect.objectContaining({
        method: "PUT",
        keepalive: true,
        credentials: "same-origin",
        body: JSON.stringify({
          chapter: "1 计算机系统概论",
          chunk_id: "co_chunk_k0013",
          paragraph_index: 3,
          source_expanded: true,
        }),
      }),
    ]);
  });

  it("loads the evidence-backed learning profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        course_id: "course_ds_001",
        evidence_count: 9,
        dimensions: [],
        trend: [],
        updated_at: "2026-07-22T09:30:00Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const getLearningProfile = (
      client as unknown as {
        getLearningProfile: () => Promise<{ course_id: string; evidence_count: number }>;
      }
    ).getLearningProfile;
    const result = await getLearningProfile();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/learning-profile?course_id=course_ds_001",
      expect.any(Object),
    );
    expect(result.evidence_count).toBe(9);
  });

  it("loads the authenticated personal learning dashboard without a user id parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      generated_at: "2026-08-07T00:00:00.000Z",
      totals: {
        course_count: 0,
        concept_count: 0,
        started_concept_count: 0,
        practice_attempt_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        needs_review_count: 0,
      },
      courses: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getPersonalLearningDashboard();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/personal-learning-dashboard",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("loads the six-dimension ability assessment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        student_id: "user_demo_001",
        major: "计算机科学与技术",
        course_id: "course_ds_001",
        overall_score: 68,
        confidence: 86,
        evidence_count: 27,
        updated_at: "2026-07-23T10:30:00.000Z",
        dimensions: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const getAbilityAssessment = (
      client as unknown as {
        getAbilityAssessment: () => Promise<{ overall_score: number; evidence_count: number }>;
      }
    ).getAbilityAssessment;
    const result = await getAbilityAssessment();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/ability-assessment?course_id=course_ds_001",
      expect.any(Object),
    );
    expect(result.overall_score).toBe(68);
    expect(result.evidence_count).toBe(27);
  });

  it("opens a question session and parses the answer event stream", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ session_id: "session_001" }))
      .mockResolvedValueOnce(jsonResponse({ event_url: "/api/v1/agent-runs/run_001/events" }))
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          'event: assistant.delta\ndata: {"run_id":"run_001","sequence":1,"created_at":"2026-07-22T09:32:01Z","payload":{"delta":"回答"}}\n\n',
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const askCourseQuestion = (
      client as unknown as {
        askCourseQuestion: (content: string) => Promise<Array<{ type: string }>>;
      }
    ).askCourseQuestion;
    const events = await askCourseQuestion("BFS 为什么能求无权图最短路？");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events[0]?.type).toBe("assistant.delta");
    const sessionOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(sessionOptions.body))).toMatchObject({
      course_id: "course_408_001",
      learning_node_id: "node_408_ai_companion",
      task_id: "task_408_open_question",
    });
    const messageOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(messageOptions.body))).toMatchObject({
      content: "BFS 为什么能求无权图最短路？",
    });
    expect(JSON.parse(String(messageOptions.body))).not.toHaveProperty("mock_scenario");
  });

  it("reuses one task session and sends the selected hint level with workspace context", async () => {
    const streamResponse = {
      ok: true,
      text: async () =>
        'event: assistant.delta\ndata: {"run_id":"run_001","sequence":1,"created_at":"2026-07-22T09:32:01Z","payload":{"delta":"回答"}}\n\n',
    } as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ session_id: "session_001" }))
      .mockResolvedValueOnce(jsonResponse({ event_url: "/api/v1/agent-runs/run_001/events" }))
      .mockResolvedValueOnce(streamResponse)
      .mockResolvedValueOnce(jsonResponse({ event_url: "/api/v1/agent-runs/run_002/events" }))
      .mockResolvedValueOnce(streamResponse);
    vi.stubGlobal("fetch", fetchMock);

    await client.askCourseQuestion("先看哪里？", "auto", {
      hintLevel: "direction",
      workspaceContext: {
        active_view: "tests",
        language: "cpp",
        task_title: "修复 BFS 重复入队问题",
        task_id: "task_bfs_bug_001",
        learning_node_id: "node_bfs_001",
        submission_id: "submission_001",
        code_excerpt: "visited[current] = true;",
        test_summary: "菱形汇聚图失败",
        trace_summary: null,
        error_line: 14,
        selected_test_case_id: "case_diamond",
        failed_test_cases: ["菱形汇聚图失败"],
        trace_variant: "visited-on-dequeue",
        learner_weak_points: ["BFS visited 标记时机"],
      },
    });
    await client.askCourseQuestion("为什么？", "auto", { hintLevel: "clue" });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/learning-sessions");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "/api/v1/learning-sessions/session_001/messages",
    );
    const firstMessage = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    const secondMessage = JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body));
    expect(firstMessage).toMatchObject({
      hint_level: "direction",
      workspace_context: {
        active_view: "tests",
        task_id: "task_bfs_bug_001",
        error_line: 14,
      },
    });
    expect(secondMessage).toMatchObject({ hint_level: "clue" });
  });

  it("sends objective workbench evidence with a diagnosis request", async () => {
    const streamResponse = {
      ok: true,
      text: async () =>
        'event: assistant.delta\ndata: {"run_id":"run_001","sequence":1,"created_at":"2026-07-22T09:32:01Z","payload":{"delta":"诊断"}}\n\n',
    } as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ session_id: "session_001" }))
      .mockResolvedValueOnce(jsonResponse({ event_url: "/api/v1/agent-runs/run_001/events" }))
      .mockResolvedValueOnce(streamResponse);
    vi.stubGlobal("fetch", fetchMock);
    const workspaceContext: client.TutorWorkspaceContext = {
      active_view: "evidence",
      language: "cpp",
      task_title: "修复 BFS 重复入队问题",
      task_id: "task_bfs_bug_001",
      learning_node_id: "node_bfs_001",
      submission_id: "sub_001",
      code_excerpt: "visited[current] = true;",
      test_summary: "2/4 个用例通过",
      trace_summary: "节点 4 重复入队",
      error_line: 14,
      selected_test_case_id: "case_diamond",
      failed_test_cases: ["菱形汇聚图失败"],
      trace_variant: "visited-on-dequeue",
      learner_weak_points: ["BFS visited 标记时机"],
    };

    await client.runDiagnosis("sub_001", "normal", workspaceContext);

    const messageOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(messageOptions.body))).toMatchObject({
      submission_id: "sub_001",
      requested_action: "diagnosis",
      hint_level: "clue",
      workspace_context: {
        active_view: "evidence",
        submission_id: "sub_001",
        test_summary: "2/4 个用例通过",
        error_line: 14,
      },
    });
    expect(JSON.parse(String(messageOptions.body))).not.toHaveProperty("mock_scenario");
  });

  it("loads only the public readiness status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "ready" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.getSystemStatus();

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system-status", expect.any(Object));
    expect(result).toEqual({ status: "ready" });
    expectTypeOf(result).toEqualTypeOf<{ status: "ready" }>();
  });

  it("loads the student AI workflow status with the server session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        state: "not_configured",
        label: "AI 服务待连接",
        detail: "尚未配置外部 AI 学习工作流。",
        checked_at: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const getAiWorkflowStatus = (
      client as unknown as {
        getAiWorkflowStatus: (capability: "diagnose") => Promise<{ state: string; label: string }>;
      }
    ).getAiWorkflowStatus;

    const result = await getAiWorkflowStatus("diagnose");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/ai-workflows/status?capability=diagnose",
      expect.objectContaining({
        credentials: "same-origin",
      }),
    );
    expect(result).toMatchObject({
      state: "not_configured",
      label: "AI 服务待连接",
    });
  });

  it("keeps the selected language in run and submission requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "failed", language: "python" }))
      .mockResolvedValueOnce(jsonResponse({ submission_id: "sub_python_001" }));
    vi.stubGlobal("fetch", fetchMock);

    await client.runTask("task_bfs_bug_001", "python", "def bfs():\n    pass", null);
    await client.submitTask(
      "task_bfs_bug_001",
      1,
      "python",
      "def bfs():\n    pass",
      "start=7\n7 8\n7 9",
    );

    const runOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const submitOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(runOptions.body))).toMatchObject({ language: "python" });
    expect(JSON.parse(String(submitOptions.body))).toMatchObject({
      code: { language: "python" },
      custom_input: "start=7\n7 8\n7 9",
    });
  });

  it("requests a trace for the selected programming language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ language: "python" }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getAlgorithmTrace(
      "task_bfs_bug_001",
      "python",
      "visited-on-dequeue",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task_bfs_bug_001/trace?language=python&variant=visited-on-dequeue",
      expect.any(Object),
    );
  });

  it("passes custom graph input through to the trace endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ language: "cpp" }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getAlgorithmTrace(
      "task_bfs_bug_001",
      "cpp",
      "visited-on-dequeue",
      "start=7\n7 8\n7 9",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task_bfs_bug_001/trace?language=cpp&variant=visited-on-dequeue&custom_input=start%3D7%0A7+8%0A7+9",
      expect.any(Object),
    );
  });

  it("loads one filtered question without requesting answer fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, limit: 1, offset: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const getQuestionBankQuestions = (
      client as unknown as {
        getQuestionBankQuestions: (selection: {
          mode: "targeted";
          subject: string;
          year: number;
          type: "choice";
          tags: string[];
          limit: number;
          offset: number;
        }) => Promise<{ total: number }>;
      }
    ).getQuestionBankQuestions;

    await getQuestionBankQuestions({
      mode: "targeted",
      subject: "数据结构",
      year: 2026,
      type: "choice",
      tags: ["线性表", "栈"],
      limit: 1,
      offset: 2,
    });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/api/v1/question-bank/questions?");
    expect(new URLSearchParams(requestedUrl.split("?")[1])).toEqual(
      new URLSearchParams({
        mode: "targeted",
        subject: "数据结构",
        year: "2026",
        type: "choice",
        tags: "线性表,栈",
        tag_match: "all",
        limit: "1",
        offset: "2",
      }),
    );
  });

  it("loads the signed-in student's past-exam catalog and builds protected asset URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getPastExamCatalog();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/question-bank/past-exams",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(client.getQuestionAssetUrl("2026/01", "asset ?#1")).toBe(
      "/api/v1/question-bank/questions/2026%2F01/assets/asset%20%3F%231",
    );
    expect(client.getQuestionAssetUrl("2026/01", "asset ?#1", "attempt /1")).toBe(
      "/api/v1/question-bank/questions/2026%2F01/assets/asset%20%3F%231?attempt_id=attempt+%2F1",
    );
  });

  it("starts and submits a server-owned mock exam", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        session_id: "exam_session_001",
        year: 2023,
        status: "active",
        duration_minutes: 180,
        server_now: "2026-08-24T06:00:00.000Z",
        started_at: "2026-08-24T06:00:00.000Z",
        expires_at: "2026-08-24T09:00:00.000Z",
        submitted_at: null,
        resumed: false,
        questions: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        session_id: "exam_session_001",
        status: "submitted",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await client.startMockExam({ year: 2023 });
    await client.submitMockExam("exam_session_001", {
      answers: [{
        question_id: "2023-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      }],
    }, "mock-submit-001");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/question-bank/mock-exams",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ year: 2023 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/question-bank/mock-exams/exam_session_001/submit",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "Idempotency-Key": "mock-submit-001" }),
        body: JSON.stringify({
          answers: [{
            question_id: "2023-01",
            answer_type: "choice",
            selected_option_ids: ["A"],
          }],
        }),
      }),
    );
  });

  it("submits a choice answer with the server session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        attempt: { attempt_id: "attempt_001" },
        evaluation: { evaluation_id: "evaluation_001" },
        evidence: { evidence_id: "evidence_001" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const submitQuestionAnswer = (
      client as unknown as {
        submitQuestionAnswer: (submission: {
          question_id: string;
          answer_type: "choice";
          selected_option_ids: string[];
        }, idempotencyKey: string) => Promise<unknown>;
      }
    ).submitQuestionAnswer;

    await submitQuestionAnswer({
      question_id: "2026-01",
      answer_type: "choice",
      selected_option_ids: ["A"],
    }, "choice-session-001");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/question-bank/evaluations",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          question_id: "2026-01",
          answer_type: "choice",
          selected_option_ids: ["A"],
        }),
      }),
    );
  });

  it("sends the caller-provided idempotency key with a choice answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        attempt: { attempt_id: "attempt_001" },
        evaluation: { evaluation_id: "evaluation_001" },
        evidence: { evidence_id: "evidence_001" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const submitQuestionAnswer = (
      client as unknown as {
        submitQuestionAnswer: (
          submission: {
            question_id: string;
            answer_type: "choice";
            selected_option_ids: string[];
          },
          idempotencyKey: string,
        ) => Promise<unknown>;
      }
    ).submitQuestionAnswer;

    await submitQuestionAnswer(
      {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
      "choice-submit-001",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/question-bank/evaluations",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "choice-submit-001" }),
      }),
    );
  });

  it("invokes the server-owned AI workflow gateway with only the browser-safe invocation", async () => {
    const invocation = {
      contract_version: "0.2" as const,
      capability: "explain" as const,
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      qa_id: null,
      attempt_id: null,
      user_message: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        contract_version: "0.2",
        request_id: "workflow_req_001",
        capability: "explain",
        slot: "contextual_explanation",
        status: "unavailable",
        display_blocks: [],
        citations: [],
        evidence_refs: [],
        next_actions: [],
        failure: {
          code: "WORKFLOW_NOT_CONNECTED",
          message: "AI workflow service is not configured.",
          retryable: true,
          fallback_message: "课程讲解仍可继续。",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client.invokeAiWorkflow(invocation);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/ai-workflows/explain",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify(invocation),
      }),
    );
    const sentBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("user_id");
    expect(sentBody).not.toHaveProperty("context");
    expect(sentBody).not.toHaveProperty("correct_option_ids");
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("AI_WORKFLOW_SECRET");
  });

  it("shares one in-flight AI workflow request for duplicate callers", async () => {
    const invocation = {
      contract_version: "0.2" as const,
      capability: "explain" as const,
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      qa_id: null,
      attempt_id: null,
      user_message: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      contract_version: "0.2",
      request_id: "workflow_req_shared_001",
      capability: "explain",
      slot: "contextual_explanation",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "AI 服务暂时不可用。",
        retryable: true,
        fallback_message: "课程讲解仍可继续。",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      client.invokeAiWorkflow(invocation),
      client.invokeAiWorkflow(invocation),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invokes the server-owned student profile workflow without sending identity or evidence internals", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        contract_version: "0.2",
        request_id: "profile_req_001",
        status: "unavailable",
        profile_summary: "AI 画像解读暂不可用，确定性画像仍可查看。",
        course_progress: [],
        strengths: [],
        priority_gaps: [],
        evidence_summary: {
          objective_evidence_count: 0,
          subjective_evidence_count: 1,
          reading_progress_count: 0,
          practice_attempt_count: 0,
          needs_review_count: 0,
          explanation: "证据正在积累。",
        },
        next_tasks: [],
        failure: {
          code: "WORKFLOW_NOT_CONNECTED",
          message: "画像工作流尚未接入。",
          retryable: true,
          fallback_message: "确定性画像仍可查看。",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.runStudentProfileWorkflow("course_408_co");

    expect(result.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/profile/ai",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ course_id: "course_408_co" }),
      }),
    );
    const sentBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(sentBody.course_id).toBe("course_408_co");
    expect(sentBody).not.toHaveProperty("user_id");
    expect(sentBody).not.toHaveProperty("correct_option_ids");
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("AI_PROFILE_WORKFLOW_SECRET");
  });

  it("loads the administrator governance foundation with the server admin session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ course_id: "course_408_001" }));
    vi.stubGlobal("fetch", fetchMock);

    const adminClient = client as unknown as {
      getManagedQuestions: (courseId: string) => Promise<unknown>;
      getManagedMaterials: (courseId: string) => Promise<unknown>;
      getManagedLearningSummary: (courseId: string) => Promise<unknown>;
    };
    await adminClient.getManagedQuestions("course_408_001");
    await adminClient.getManagedMaterials("course_408_001");
    await adminClient.getManagedLearningSummary("course_408_001");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/manage/courses/course_408_001/questions",
      "/api/v1/manage/courses/course_408_001/materials",
      "/api/v1/manage/courses/course_408_001/learning-summary",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(expect.objectContaining({ credentials: "same-origin" }));
    }
  });

  it("loads the authorized course student learning summaries without an account id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      course_id: "course_408_001",
      items: [],
      generated_at: "2026-08-23T08:00:00.000Z",
      data_scope: "stored_records_only",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const getManagedCourseStudents = (
      client as unknown as {
        getManagedCourseStudents: (
          courseId: string,
          query: { page: number; page_size: number; class_name: string; learning_status: string },
        ) => Promise<{ items: unknown[] }>;
      }
    ).getManagedCourseStudents;
    await getManagedCourseStudents("course_408_001", {
      page: 1,
      page_size: 20,
      class_name: "",
      learning_status: "all",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/courses/course_408_001/students?page=1&page_size=20&class_name=&learning_status=all",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/password_hash|answer_key|user[_-]?id/iu);
  });

  it("loads course evidence and records a bounded teacher intervention", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        course_id: "course_408_001",
        generated_at: "2026-08-23T08:00:00.000Z",
        data_scope: "stored_records_only",
        active_student_count: 1,
        top_weak_concepts: [],
        recent_interventions: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        intervention_id: "intervention_001",
        course_id: "course_408_001",
        concept_id: "co_c01_01",
        concept_title: "指令执行流程",
        action: "assign_review",
        note: "下一次课先复习。",
        created_at: "2026-08-23T08:00:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const adminClient = client as unknown as {
      getManagedCourseEvidence: (courseId: string) => Promise<unknown>;
      recordManagedTeacherIntervention: (courseId: string, input: unknown) => Promise<unknown>;
    };
    await adminClient.getManagedCourseEvidence("course_408_001");
    await adminClient.recordManagedTeacherIntervention("course_408_001", {
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "下一次课先复习。",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/manage/courses/course_408_001/evidence",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/manage/courses/course_408_001/interventions",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "下一次课先复习。",
      }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/actor_user_id|answer_key|password_hash/iu);
  });

  it("passes a bounded evidence window and advances an intervention status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        course_id: "course_408_001",
        generated_at: "2026-08-23T08:00:00.000Z",
        data_scope: "stored_records_only",
        active_student_count: 5,
        top_weak_concepts: [],
        recent_interventions: [],
      }))
      .mockResolvedValueOnce(jsonResponse({ status: "sent" }));
    vi.stubGlobal("fetch", fetchMock);

    const adminClient = client as unknown as {
      getManagedCourseEvidence: (courseId: string, query: {
        days: number;
        start_at: string;
        end_at: string;
        source_scope: "real_trial_only" | "real_and_synthetic";
      }) => Promise<unknown>;
      updateManagedTeacherInterventionStatus: (
        courseId: string,
        interventionId: string,
        status: "sent" | "completed" | "cancelled",
      ) => Promise<unknown>;
    };
    await adminClient.getManagedCourseEvidence("course_408_001", {
      days: 7,
      start_at: "2026-08-18T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
      source_scope: "real_trial_only",
    });
    await adminClient.updateManagedTeacherInterventionStatus(
      "course_408_001",
      "intervention_001",
      "sent",
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/manage/courses/course_408_001/evidence?days=7&start_at=2026-08-18T00%3A00%3A00.000Z&end_at=2026-08-25T00%3A00%3A00.000Z&source_scope=real_trial_only",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/manage/courses/course_408_001/interventions/intervention_001/status",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "sent" }),
    }));
  });

  it("uses session-scoped class enrollment endpoints for students and teachers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const enrollmentClient = client as unknown as {
      getStudentClassEnrollmentStatus: () => Promise<unknown>;
      submitStudentClassEnrollmentRequest: (input: unknown) => Promise<unknown>;
      cancelStudentClassEnrollmentRequest: () => Promise<unknown>;
      getTeacherClassManagement: (courseId: string) => Promise<unknown>;
      createTeacherClass: (courseId: string, input: unknown) => Promise<unknown>;
      createTeacherClassInvitation: (courseId: string, classId: string) => Promise<unknown>;
      revokeTeacherClassInvitation: (courseId: string, classId: string) => Promise<unknown>;
      decideTeacherClassEnrollmentRequest: (
        courseId: string,
        classId: string,
        requestId: string,
        input: unknown,
      ) => Promise<unknown>;
      removeTeacherClassMember: (
        courseId: string,
        classId: string,
        studentCode: string,
      ) => Promise<unknown>;
    };

    await enrollmentClient.getStudentClassEnrollmentStatus();
    await enrollmentClient.submitStudentClassEnrollmentRequest({
      invite_code: "ABCD-7K9M",
      student_number: "2315929354",
    });
    await enrollmentClient.cancelStudentClassEnrollmentRequest();
    await enrollmentClient.getTeacherClassManagement("course_408_ds");
    await enrollmentClient.createTeacherClass("course_408_ds", {
      class_name: "软件工程2301班",
      cohort_year: 2023,
      major: "软件工程",
    });
    await enrollmentClient.createTeacherClassInvitation("course_408_ds", "class_se_2301");
    await enrollmentClient.revokeTeacherClassInvitation("course_408_ds", "class_se_2301");
    await enrollmentClient.decideTeacherClassEnrollmentRequest(
      "course_408_ds",
      "class_se_2301",
      "enrollment_request_1",
      { decision: "approved" },
    );
    await enrollmentClient.removeTeacherClassMember(
      "course_408_ds",
      "class_se_2301",
      "P7F3A1C20",
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/student/class-enrollment",
      "/api/v1/student/class-enrollment/requests",
      "/api/v1/student/class-enrollment/requests/current",
      "/api/v1/manage/courses/course_408_ds/classes",
      "/api/v1/manage/courses/course_408_ds/classes",
      "/api/v1/manage/courses/course_408_ds/classes/class_se_2301/invitation",
      "/api/v1/manage/courses/course_408_ds/classes/class_se_2301/invitation",
      "/api/v1/manage/courses/course_408_ds/classes/class_se_2301/requests/enrollment_request_1/decision",
      "/api/v1/manage/courses/course_408_ds/classes/class_se_2301/members/P7F3A1C20",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ invite_code: "ABCD-7K9M", student_number: "2315929354" }),
    }));
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ class_name: "软件工程2301班", cohort_year: 2023, major: "软件工程" }),
    }));
    expect(fetchMock.mock.calls[7]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ decision: "approved" }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/teacher_user_id|user_id|password_hash/iu);
  });

  it("uses only authenticated onboarding endpoints without accepting a user id", async () => {
    const goals = {
      target_exam_year: 2027,
      preparation_stage: "foundation" as const,
      daily_minutes: 60,
      target_school: null,
      target_score: 120,
    };
    const selfAssessments = {
      items: [
        { course_id: "course_408_ds" as const, level: "weak" as const },
        { course_id: "course_408_co" as const, level: "average" as const },
        { course_id: "course_408_os" as const, level: "good" as const },
        { course_id: "course_408_cn" as const, level: "not_started" as const },
      ],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "not_started" }))
      .mockResolvedValueOnce(jsonResponse({ status: "in_progress" }))
      .mockResolvedValueOnce(jsonResponse({ status: "in_progress" }))
      .mockResolvedValueOnce(jsonResponse({ set_version: "408-v2", summary: { total_count: 8, saved_count: 0, completed_at: null }, items: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "in_progress" }))
      .mockResolvedValueOnce(jsonResponse({ status: "in_progress" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getStudentOnboardingState();
    await client.saveStudentOnboardingGoals(goals);
    await client.saveStudentOnboardingSelfAssessments(selfAssessments);
    await client.getStudentOnboardingDiagnosticQuestions();
    await client.saveStudentOnboardingDiagnosticAnswer({
      question_id: "question_1",
      response_status: "unsure",
      selected_option_ids: [],
    });
    await client.completeStudentOnboardingDiagnostic();
    await client.completeStudentOnboarding();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/student/onboarding",
      "/api/v1/student/onboarding/goals",
      "/api/v1/student/onboarding/self-assessments",
      "/api/v1/student/onboarding/diagnostic/questions",
      "/api/v1/student/onboarding/diagnostic/answers",
      "/api/v1/student/onboarding/diagnostic/complete",
      "/api/v1/student/onboarding/complete",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      credentials: "same-origin",
      body: JSON.stringify(goals),
    }));
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(selfAssessments),
    }));
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        question_id: "question_1",
        response_status: "unsure",
        selected_option_ids: [],
      }),
    }));
    expect(fetchMock.mock.calls[5]?.[1]).toEqual(expect.objectContaining({ method: "POST", body: "{}" }));
    expect(fetchMock.mock.calls[6]?.[1]).toEqual(expect.objectContaining({ method: "POST", body: "{}" }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id/i);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id/i);
  });

  it("runs and persists the account-owned programming experiment through student APIs", async () => {
    const input = {
      language: "cpp" as const,
      source: "vector<int> bfs() { return {}; }",
      custom_input: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ definition: { experiment_id: "ds-bfs-visited-v1" }, latest_attempt: null, attempt_count: 0 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ run_id: "sandbox_run_001", execution_mode: "sandbox" }))
      .mockResolvedValueOnce(jsonResponse({ attempt_id: "prog_attempt_001", result: { execution_mode: "sandbox" } }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getProgrammingExperiment("ds-bfs-visited-v1");
    await client.getProgrammingExperimentAttempts("ds-bfs-visited-v1", 12);
    await client.runProgrammingExperiment("ds-bfs-visited-v1", input);
    await client.submitProgrammingExperimentAttempt(
      "ds-bfs-visited-v1",
      input,
      "programming-attempt-001",
    );

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/student/programming-experiments/ds-bfs-visited-v1",
      "/api/v1/student/programming-experiments/ds-bfs-visited-v1/attempts?limit=12",
      "/api/v1/student/programming-experiments/ds-bfs-visited-v1/runs",
      "/api/v1/student/programming-experiments/ds-bfs-visited-v1/attempts",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify(input),
    }));
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "programming-attempt-001" }),
      body: JSON.stringify(input),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id/iu);
  });

  it("loads the authenticated student's programming experiment catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.getProgrammingExperimentCatalog();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/programming-experiments",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual({ items: [] });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id/iu);
  });

  it("advances the authenticated pilot through server-owned evidence endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ kind: "enrolled" }));
    vi.stubGlobal("fetch", fetchMock);
    const consent = {
      accepted: true as const,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 3,
    };
    const feedback = {
      ease_of_use: 4,
      guidance_helpfulness: 5,
      confidence_after: 4,
      continued_use_intent: 4,
      open_feedback: "流程清楚。",
    };

    await client.getPilotStudy();
    await client.recordPilotConsent(consent);
    await client.startPilotTask("pilot_task_baseline");
    await client.completePilotTask("pilot_task_baseline", { attempt_id: "attempt_001" });
    await client.submitPilotFeedback(feedback);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/student/pilot-study",
      "/api/v1/student/pilot-study/consent",
      "/api/v1/student/pilot-study/tasks/pilot_task_baseline/start",
      "/api/v1/student/pilot-study/tasks/pilot_task_baseline/complete",
      "/api/v1/student/pilot-study/feedback",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify(consent),
    }));
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ attempt_id: "attempt_001" }),
    }));
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify(feedback),
    }));
  });

  it("loads, enrolls and downloads anonymous pilot management data", async () => {
    const createObjectUrl = vi.fn(() => "blob:pilot-report");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const reportResponse = {
      ok: true,
      headers: new Headers({
        "content-disposition": "attachment; filename=\"xuetu-pilot.csv\"",
      }),
      blob: async () => new Blob(["anonymous"], { type: "text/csv" }),
    } as Response;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ summary: {}, participants: [] }))
      .mockResolvedValueOnce(jsonResponse({ participant_code: "P001" }))
      .mockResolvedValueOnce(reportResponse);
    vi.stubGlobal("fetch", fetchMock);
    const enrollment = {
      username: "trial_student_01",
      participant_code: "P001",
      role_label: "2023级计算机科学与技术专业学生",
      participant_kind: "real_trial" as const,
    };

    await client.getPilotManagementReport(true);
    await client.enrollPilotParticipant(enrollment);
    await client.downloadPilotReport("csv", false);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/manage/pilot-study?include_synthetic=true",
      "/api/v1/manage/pilot-study/participants",
      "/api/v1/manage/pilot-study/export.csv",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify(enrollment),
    }));
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:pilot-report");
    click.mockRestore();
  });

  it("uploads one external question image as cookie-authenticated FormData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      external_question_id: "external_question_001",
      status: "recognized",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const image = new File(["clear-408-question"], "queue-question.png", {
      type: "image/png",
    });

    const uploadExternalQuestion = (
      client as unknown as {
        uploadExternalQuestion: (file: File, idempotencyKey: string) => Promise<unknown>;
      }
    ).uploadExternalQuestion;
    await uploadExternalQuestion(image, "external-upload-001");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/student/external-questions");
    expect(init).toEqual(expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
    }));
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("image")).toBe(image);
    const headers = new Headers(init.headers);
    expect(headers.get("Idempotency-Key")).toBe("external-upload-001");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.has("Content-Type")).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id|model/iu);
  });

  it("forwards an AbortSignal to external-question fetch requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      external_question_id: "external_question_001",
      status: "recognized",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const image = new File(["clear-408-question"], "queue-question.png", {
      type: "image/png",
    });
    const controller = new AbortController();

    const uploadExternalQuestion = (
      client as unknown as {
        uploadExternalQuestion: (file: File, idempotencyKey: string, signal?: AbortSignal) => Promise<unknown>;
      }
    ).uploadExternalQuestion;
    await uploadExternalQuestion(image, "external-upload-abort", controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it("forwards the same AbortSignal across the external-question lifecycle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const image = new File(["clear-408-question"], "queue-question.png", {
      type: "image/png",
    });
    const externalQuestionClient = client as unknown as {
      uploadExternalQuestion: (file: File, key: string, signal?: AbortSignal) => Promise<unknown>;
      retryExternalQuestionRecognition: (id: string, key: string, signal?: AbortSignal) => Promise<unknown>;
      confirmExternalQuestion: (id: string, input: unknown, key: string, signal?: AbortSignal) => Promise<unknown>;
      explainExternalQuestion: (id: string, depth: "steps", key: string, signal?: AbortSignal) => Promise<unknown>;
      saveExternalQuestion: (id: string, key: string, signal?: AbortSignal) => Promise<unknown>;
      getExternalQuestions: (signal?: AbortSignal) => Promise<unknown>;
      getExternalQuestion: (id: string, signal?: AbortSignal) => Promise<unknown>;
      deleteExternalQuestion: (id: string, key: string, signal?: AbortSignal) => Promise<unknown>;
    };
    const confirmation = {
      subject: "data_structures",
      question_type: "choice",
      question_text: "队列遵循什么原则？",
      options: [
        { label: "A", text: "先进先出" },
        { label: "B", text: "先进后出" },
      ],
      formulae: [],
      diagram_description: null,
    };

    await externalQuestionClient.uploadExternalQuestion(image, "signal-upload", controller.signal);
    await externalQuestionClient.retryExternalQuestionRecognition("question-1", "signal-retry", controller.signal);
    await externalQuestionClient.confirmExternalQuestion("question-1", confirmation, "signal-confirm", controller.signal);
    await externalQuestionClient.explainExternalQuestion("question-1", "steps", "signal-explain", controller.signal);
    await externalQuestionClient.saveExternalQuestion("question-1", "signal-save", controller.signal);
    await externalQuestionClient.getExternalQuestions(controller.signal);
    await externalQuestionClient.getExternalQuestion("question-1", controller.signal);
    await externalQuestionClient.deleteExternalQuestion("question-1", "signal-delete", controller.signal);

    expect(fetchMock.mock.calls).toHaveLength(8);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(expect.objectContaining({ signal: controller.signal }));
    }
  });

  it("uses encoded account-owned external-question JSON endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ external_question_id: "question /unsafe?" }))
      .mockResolvedValueOnce(jsonResponse({ external_question_id: "question /unsafe?" }))
      .mockResolvedValueOnce(jsonResponse({ external_question_id: "question /unsafe?" }))
      .mockResolvedValueOnce(jsonResponse({ external_question_id: "question /unsafe?" }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ external_question_id: "question /unsafe?" }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);
    const externalQuestionClient = client as unknown as {
      retryExternalQuestionRecognition: (id: string, key: string) => Promise<unknown>;
      confirmExternalQuestion: (id: string, input: unknown, key: string) => Promise<unknown>;
      explainExternalQuestion: (id: string, depth: "steps", key: string) => Promise<unknown>;
      saveExternalQuestion: (id: string, key: string) => Promise<unknown>;
      getExternalQuestions: () => Promise<unknown>;
      getExternalQuestion: (id: string) => Promise<unknown>;
      externalQuestionImageUrl: (id: string) => string;
      deleteExternalQuestion: (id: string, key: string) => Promise<unknown>;
    };
    const id = "question /unsafe?";
    const encoded = "question%20%2Funsafe%3F";
    const confirmation = {
      subject: "data_structures",
      question_type: "choice",
      question_text: "队列遵循什么原则？",
      options: [
        { label: "A", text: "先进先出" },
        { label: "B", text: "先进后出" },
      ],
      formulae: [],
      diagram_description: null,
    };

    await externalQuestionClient.retryExternalQuestionRecognition(id, "recognize-001");
    await externalQuestionClient.confirmExternalQuestion(id, confirmation, "confirm-001");
    await externalQuestionClient.explainExternalQuestion(id, "steps", "explain-001");
    await externalQuestionClient.saveExternalQuestion(id, "save-001");
    await externalQuestionClient.getExternalQuestions();
    await externalQuestionClient.getExternalQuestion(id);
    expect(externalQuestionClient.externalQuestionImageUrl(id)).toBe(
      `/api/v1/student/external-questions/${encoded}/image`,
    );
    await externalQuestionClient.deleteExternalQuestion(id, "delete-001");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/student/external-questions/${encoded}/recognition`,
      `/api/v1/student/external-questions/${encoded}/confirmation`,
      `/api/v1/student/external-questions/${encoded}/explanations`,
      `/api/v1/student/external-questions/${encoded}/save`,
      "/api/v1/student/external-questions",
      `/api/v1/student/external-questions/${encoded}`,
      `/api/v1/student/external-questions/${encoded}`,
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({ "Idempotency-Key": "recognize-001" }),
    }));
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(confirmation),
      headers: expect.objectContaining({ "Idempotency-Key": "confirm-001" }),
    }));
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ depth: "steps" }),
      headers: expect.objectContaining({ "Idempotency-Key": "explain-001" }),
    }));
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({ "Idempotency-Key": "save-001" }),
    }));
    expect(fetchMock.mock.calls[6]?.[1]).toEqual(expect.objectContaining({
      method: "DELETE",
      headers: expect.objectContaining({ "Idempotency-Key": "delete-001" }),
    }));
    for (const [, init] of fetchMock.mock.calls.slice(0, 4)) {
      expect(new Headers((init as RequestInit).headers).get("Content-Type")).toBe(
        "application/json",
      );
    }
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/user[_-]?id|model/iu);
  });
});

describe("streamAgentChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sseFrame(event: string, data: unknown) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  it("posts the message and streams SSE events back", async () => {
    const events: client.AgentChatStreamEvent[] = [];
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      sseFrame("agent.delta", { delta: "传输层与网络层分工不同。" })
      + sseFrame("agent.done", { text: "传输层与网络层分工不同。" }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await client.streamAgentChat("TCP 传输层与网络层有什么区别？", "study", {
      onEvent: (event) => events.push(event),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agent/chat",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ message: "TCP 传输层与网络层有什么区别？", context: "study" }),
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
      }),
    );
    expect(events).toEqual([
      { type: "agent.delta", delta: "传输层与网络层分工不同。" },
      { type: "agent.done", text: "传输层与网络层分工不同。" },
    ]);
  });

  it("throws an ApiError with the envelope message when the service is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        error: {
          code: "AGENT_CHAT_NOT_CONFIGURED",
          message: "全局智能体暂不可用，请稍后重试。",
          retryable: true,
        },
      }),
      { status: 503 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.streamAgentChat("你好", "lab")).rejects.toMatchObject({
      code: "AGENT_CHAT_NOT_CONFIGURED",
      message: "全局智能体暂不可用，请稍后重试。",
      retryable: true,
    });
  });
});
