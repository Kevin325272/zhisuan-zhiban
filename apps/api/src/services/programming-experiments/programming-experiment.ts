import {
  programmingExperimentDefinitionSchema,
  programmingExperimentDiagnosisSchema,
  type CodeRunResult,
  type ProgrammingExperimentDefinition,
  type ProgrammingExperimentDiagnosis,
} from "@xuetu/contracts";

import { getProgrammingLanguageDefinition } from "../../domain/programming-languages.js";

export const DATA_STRUCTURES_BFS_EXPERIMENT_ID = "ds-bfs-visited-v1";

const definition = programmingExperimentDefinitionSchema.parse({
  experiment_id: DATA_STRUCTURES_BFS_EXPERIMENT_ID,
  course_id: "course_408_ds",
  course_slug: "data-structures",
  concept_id: "ds_c06_03",
  task_id: "task_bfs_bug_001",
  title: "修复 BFS 重复入队问题",
  subtitle: "广度优先搜索 · visited 标记时机",
  learning_objective: "理解发现顶点、标记 visited 与加入队列之间的时序，并能用边界用例验证实现。",
  prompt: "修复给定 BFS 实现，使每个顶点最多入队一次，同时保持正确的广度优先访问顺序。",
  requirements: [
    "保留函数签名和广度优先遍历结构",
    "每个顶点最多加入待访问队列一次",
    "连通、汇聚、自环和非连通输入均保持正确行为",
  ],
  success_criteria: [
    "4 个固定用例全部通过",
    "评测结果来自隔离沙箱而非演示规则",
    "正式提交后产生本人可追溯的实验记录",
  ],
  language: "cpp",
  starter_code: getProgrammingLanguageDefinition("cpp").starter_code,
  data_boundary: "代码由 Judge0 第三方隔离沙箱执行；错因和下一步由客观用例结果及确定性规则生成，不是 AI 实时判断。",
}) satisfies ProgrammingExperimentDefinition;

export function getProgrammingExperimentDefinition(
  experimentId: string,
): ProgrammingExperimentDefinition | null {
  return experimentId === DATA_STRUCTURES_BFS_EXPERIMENT_ID ? definition : null;
}

export function listProgrammingExperimentDefinitions(): ProgrammingExperimentDefinition[] {
  return [definition];
}

function failedCaseEvidence(result: CodeRunResult) {
  return result.test_cases
    .filter((testCase) => testCase.status !== "passed")
    .slice(0, 3)
    .map((testCase) => `${testCase.label}：${testCase.summary}`);
}

function passedCaseEvidence(result: CodeRunResult) {
  return result.test_cases
    .filter((testCase) => testCase.status === "passed")
    .slice(0, 3)
    .map((testCase) => `${testCase.label}：${testCase.summary}`);
}

export function diagnoseProgrammingExperiment(
  result: CodeRunResult,
): ProgrammingExperimentDiagnosis {
  if (result.status === "passed" && result.total_count > 0) {
    return programmingExperimentDiagnosisSchema.parse({
      status: "passed",
      title: "实验通过",
      summary: `${result.passed_count}/${result.total_count} 个固定用例全部通过，当前实现满足本实验的客观通过标准。`,
      evidence: passedCaseEvidence(result),
      correction_goal: "返回关联知识点总结 visited 标记时机，再继续课程训练。",
      next_action: "review_concept",
    });
  }

  if (result.status === "compile_error") {
    return programmingExperimentDiagnosisSchema.parse({
      status: "compile_error",
      title: "先修复编译错误",
      summary: result.stderr?.trim() || "代码没有通过 C++ 编译检查。",
      evidence: result.error_line ? [`编译器定位到源码第 ${result.error_line} 行附近。`] : [],
      correction_goal: "先修复编译器报告的问题，再运行固定用例。",
      next_action: "retry",
    });
  }

  if (result.status === "failed") {
    const evidence = failedCaseEvidence(result);
    if (result.error_line) evidence.push(`评测定位到源码第 ${result.error_line} 行附近。`);
    const duplicateEnqueue = result.detected_variant === "visited-on-dequeue";
    return programmingExperimentDiagnosisSchema.parse({
      status: "needs_revision",
      title: duplicateEnqueue ? "重复入队仍未解决" : "仍有固定用例未通过",
      summary: duplicateEnqueue
        ? `汇聚路径中同一顶点被重复加入队列；当前客观结果为 ${result.passed_count}/${result.total_count} 个用例通过。`
        : `当前客观结果为 ${result.passed_count}/${result.total_count} 个用例通过。`,
      evidence,
      correction_goal: duplicateEnqueue
        ? "检查发现相邻顶点、标记 visited 与加入队列三者的先后顺序，再重新运行。"
        : "逐项比较失败用例的输入、期望输出与实际输出，再重新运行。",
      next_action: "retry",
    });
  }

  return programmingExperimentDiagnosisSchema.parse({
    status: "execution_error",
    title: "本次运行没有完成",
    summary: result.stderr?.trim() || "隔离沙箱未能完成本次程序运行。",
    evidence: failedCaseEvidence(result),
    correction_goal: "检查无限循环、异常访问或资源限制后重新运行。",
    next_action: "retry",
  });
}
