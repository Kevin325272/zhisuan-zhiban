import { beforeEach, describe, expect, it } from "vitest";

import {
  addGeneratedReviewCard,
  loadLearningOutputs,
  saveReviewFeedback,
  saveAbilityCalibration,
  saveMaterialNote,
} from "./learning-output-store";

describe("learning output store", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists notes and deduplicates generated review cards", () => {
    saveMaterialNote("textbook", "visited 应在入队时标记");
    const card = {
      id: "material-card-textbook",
      sourceId: "textbook",
      title: "BFS 标记时机学习卡",
      course: "数据结构",
      minutes: 8,
      reason: "来源：教材 · P143",
      href: "/student/materials?source=textbook",
      scheduledFor: "2026-07-23",
    };
    addGeneratedReviewCard(card);
    addGeneratedReviewCard(card);
    addGeneratedReviewCard({ ...card, id: "another-id-for-the-same-review" });

    const outputs = loadLearningOutputs();
    expect(outputs.notes.textbook).toBe("visited 应在入队时标记");
    expect(outputs.reviewCards).toEqual([card]);
  });

  it("persists a student's ability calibration without changing other outputs", () => {
    saveMaterialNote("textbook", "保留这条笔记");
    saveAbilityCalibration({
      goal: "coding_practice",
      weeklyHours: 6,
      answers: {
        concept: 1,
        implementation: 1,
        transfer: 0,
      },
      focusKey: "code_implementation",
      completedAt: "2026-07-24T10:00:00.000Z",
    });

    expect(loadLearningOutputs()).toMatchObject({
      notes: { textbook: "保留这条笔记" },
      abilityCalibration: {
        goal: "coding_practice",
        weeklyHours: 6,
        focusKey: "code_implementation",
      },
    });
  });

  it("persists review feedback and the evidence-based next review date", () => {
    saveReviewFeedback({
      id: "2026-07-23:BFS 重复入队错因复盘",
      title: "BFS 重复入队错因复盘",
      course: "数据结构",
      minutes: 14,
      reason: "昨日出现 2 次同类错误",
      href: "/student/tasks/task_bfs_bug_001",
      scheduledFor: "2026-07-23",
      rating: "fuzzy",
      nextReviewFor: "2026-07-26",
      answeredAt: "2026-07-24T12:00:00.000Z",
    });

    expect(loadLearningOutputs().reviewFeedback).toMatchObject({
      "2026-07-23:BFS 重复入队错因复盘": {
        rating: "fuzzy",
        nextReviewFor: "2026-07-26",
      },
    });
  });
});
