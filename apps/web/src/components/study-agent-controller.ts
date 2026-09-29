import type {
  AiWorkflowInvocation,
  AiWorkflowResponse,
  StudentLearningOrchestration,
} from "@xuetu/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAiPreferences } from "../features/ai/ai-preferences-context";

import {
  getStudentLearningOrchestration,
  invokeAiWorkflow,
} from "../api/client";

export const STUDY_AGENT_EVIDENCE_UPDATED = "xuetu:learning-evidence-updated";

export interface StudyAgentTurn {
  id: string;
  role: "student" | "agent";
  text: string;
}

const MAX_USER_MESSAGE_LENGTH = 4_000;
const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_TURN_LENGTH = 640;
const MAX_VISIBLE_TURNS = 6;

export interface StudyAgentController {
  snapshot: StudentLearningOrchestration | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
  aiLoading: boolean;
  aiError: string | null;
  explanation: string | null;
  turns: StudyAgentTurn[];
  refreshedNotice: string | null;
  reload: () => void;
  retryExplanation: () => void;
  submitQuestion: (question: string) => Promise<void>;
}

export function safeStudentAgentHref(href: string | null | undefined) {
  if (!href?.startsWith("/student/") || href.startsWith("//")) return null;
  try {
    const target = new URL(href, "https://xuetu.local");
    if (target.origin !== "https://xuetu.local" || !target.pathname.startsWith("/student/")) {
      return null;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

function boundedTurnText(text: string) {
  const normalized = text.trim();
  return normalized.length > MAX_HISTORY_TURN_LENGTH
    ? `${normalized.slice(0, MAX_HISTORY_TURN_LENGTH - 1)}…`
    : normalized;
}

export function buildStudyAgentInvocation(
  snapshot: StudentLearningOrchestration,
  question: string | null,
  turns: readonly StudyAgentTurn[],
): AiWorkflowInvocation {
  const recentTurns = turns
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => `${turn.role === "student" ? "学生" : "学习管家"}：${boundedTurnText(turn.text)}`)
    .join("\n");
  const prompt = [
    "请根据当前真实学习记录，用简洁中文解释今天这项学习安排。",
    `当前任务：${snapshot.current_task.title}`,
    `已有依据：${snapshot.evidence_summary.explanation}`,
    recentTurns ? `最近对话：\n${recentTurns}` : "",
    question ? `学生本轮问题：${question.trim()}` : "请说明为什么先做这项任务，并给出一个马上能开始的小步骤。",
    "不要声称修改了计划、成绩、掌握度或学习记录。",
  ].filter(Boolean).join("\n\n");

  return {
    contract_version: "0.2",
    capability: "plan",
    course_id: snapshot.current_task.course_id,
    concept_id: null,
    qa_id: null,
    attempt_id: null,
    user_message: prompt.slice(0, MAX_USER_MESSAGE_LENGTH),
  };
}

export function studyAgentResponseText(response: AiWorkflowResponse) {
  const content = response.display_blocks
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
  if ((response.status === "ready" || response.status === "degraded") && content) {
    return content;
  }
  if (response.status === "insufficient_context") {
    return "当前学习记录还不够完整，我先按现有目标安排这项起步任务。完成后，我会结合新的作答继续判断。";
  }
  return "这次解释暂时没有生成，当前任务仍然可以继续。你也可以稍后重新让我整理。";
}

export function notifyStudyAgentEvidenceUpdated() {
  window.dispatchEvent(new Event(STUDY_AGENT_EVIDENCE_UPDATED));
}

function boundedTurns(turns: readonly StudyAgentTurn[]) {
  return turns.slice(-MAX_VISIBLE_TURNS);
}

function readableSnapshotError(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "今天的学习任务暂时无法读取，请稍后重试。";
}

function readableAiError(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "这轮解释暂时没有生成，请稍后重试。";
}

export function useStudyAgent(enabled: boolean): StudyAgentController {
  const { preferences, status: preferenceStatus } = useAiPreferences();
  const aiEnabled = preferenceStatus === "ready" && preferences.collaboration_enabled;
  const [snapshot, setSnapshot] = useState<StudentLearningOrchestration | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [turns, setTurns] = useState<StudyAgentTurn[]>([]);
  const [refreshedNotice, setRefreshedNotice] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const workflowSequence = useRef(0);
  const turnSequence = useRef(0);
  const turnsRef = useRef<StudyAgentTurn[]>([]);

  const replaceTurns = useCallback((next: StudyAgentTurn[]) => {
    const bounded = boundedTurns(next);
    turnsRef.current = bounded;
    setTurns(bounded);
  }, []);

  const createTurn = useCallback((role: StudyAgentTurn["role"], text: string) => ({
    id: `study_agent_turn_${++turnSequence.current}`,
    role,
    text,
  }), []);

  const runWorkflow = useCallback(async (
    activeSnapshot: StudentLearningOrchestration,
    question: string | null,
    history: readonly StudyAgentTurn[],
  ) => {
    const sequence = ++workflowSequence.current;
    if (!aiEnabled) {
      setAiLoading(false);
      setAiError(null);
      setExplanation("AI 协作已暂停，你可以继续当前学习任务，或在账户设置中开启协作。");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await invokeAiWorkflow(
        buildStudyAgentInvocation(activeSnapshot, question, history),
      );
      if (workflowSequence.current !== sequence) return;
      const text = studyAgentResponseText(response);
      setExplanation(text);
      replaceTurns([...history, createTurn("agent", text)]);
      if (response.status !== "ready" && response.status !== "degraded") {
        setAiError(response.failure?.message ?? "这轮解释需要稍后重试。");
      }
    } catch (error) {
      if (workflowSequence.current !== sequence) return;
      const text = "这次解释暂时没有生成，当前任务仍然可以继续。";
      setExplanation(text);
      replaceTurns([...history, createTurn("agent", text)]);
      setAiError(readableAiError(error));
    } finally {
      if (workflowSequence.current === sequence) setAiLoading(false);
    }
  }, [aiEnabled, createTurn, replaceTurns]);

  const loadSnapshot = useCallback(async (fromEvidenceUpdate: boolean) => {
    const sequence = ++loadSequence.current;
    ++workflowSequence.current;
    setSnapshotLoading(true);
    setSnapshotError(null);
    if (fromEvidenceUpdate) {
      setRefreshedNotice("我已收到刚才的学习记录，正在重新整理下一步。");
    }
    try {
      const nextSnapshot = await getStudentLearningOrchestration();
      if (loadSequence.current !== sequence) return;
      setSnapshot(nextSnapshot);
      setSnapshotLoading(false);
      if (fromEvidenceUpdate) {
        setRefreshedNotice("我已根据刚才的学习记录更新判断。");
      }
      await runWorkflow(nextSnapshot, null, turnsRef.current);
    } catch (error) {
      if (loadSequence.current !== sequence) return;
      setSnapshotError(readableSnapshotError(error));
      setSnapshotLoading(false);
    }
  }, [runWorkflow]);

  useEffect(() => {
    if (!enabled) return undefined;
    void loadSnapshot(false);
    return () => {
      ++loadSequence.current;
      ++workflowSequence.current;
    };
  }, [enabled, loadSnapshot]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleEvidenceUpdate = () => void loadSnapshot(true);
    window.addEventListener(STUDY_AGENT_EVIDENCE_UPDATED, handleEvidenceUpdate);
    return () => window.removeEventListener(STUDY_AGENT_EVIDENCE_UPDATED, handleEvidenceUpdate);
  }, [enabled, loadSnapshot]);

  const submitQuestion = useCallback(async (question: string) => {
    const content = question.trim();
    if (!snapshot || !content || aiLoading) return;
    const nextTurns = boundedTurns([...turnsRef.current, createTurn("student", content)]);
    replaceTurns(nextTurns);
    await runWorkflow(snapshot, content, nextTurns);
  }, [aiLoading, createTurn, replaceTurns, runWorkflow, snapshot]);

  const retryExplanation = useCallback(() => {
    if (!snapshot || aiLoading) return;
    const latestQuestion = [...turnsRef.current]
      .reverse()
      .find((turn) => turn.role === "student")?.text ?? null;
    void runWorkflow(snapshot, latestQuestion, turnsRef.current);
  }, [aiLoading, runWorkflow, snapshot]);

  return {
    snapshot,
    snapshotLoading,
    snapshotError,
    aiLoading,
    aiError,
    explanation,
    turns,
    refreshedNotice,
    reload: () => void loadSnapshot(false),
    retryExplanation,
    submitQuestion,
  };
}
