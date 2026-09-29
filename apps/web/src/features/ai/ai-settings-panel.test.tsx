import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STUDENT_AI_PREFERENCES } from "@xuetu/contracts";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), invoke: vi.fn(), accountId: "student-one" }));
vi.mock("../auth/auth-context", () => ({ useAuth: () => ({ account: { user_id: mocks.accountId, roles: ["student"], must_change_password: false } }) }));
vi.mock("../../api/client", async (original) => ({ ...await original<typeof import("../../api/client")>(), getStudentAiPreferences: mocks.get, updateStudentAiPreferences: mocks.update, invokeAiWorkflow: mocks.invoke }));
import { AiPreferencesProvider } from "./ai-preferences-context";
import { AiSettingsPanel } from "./ai-settings-panel";
import { CourseAiExplanation } from "./course-ai-explanation";

const UI = () => <MemoryRouter><AiPreferencesProvider><AiSettingsPanel /><CourseAiExplanation courseId="course_408_co" conceptId="co_c01_01" /></AiPreferencesProvider></MemoryRouter>;
beforeEach(() => {
  mocks.accountId = "student-one"; mocks.get.mockReset().mockResolvedValue(DEFAULT_STUDENT_AI_PREFERENCES); mocks.update.mockReset(); mocks.invoke.mockReset();
});
describe("AI settings controls and explanatory graphics", () => {
  it("reads and persists the master switch without making an AI call", async () => {
    mocks.update.mockResolvedValue({ ...DEFAULT_STUDENT_AI_PREFERENCES, collaboration_enabled: false, updated_at: "2026-09-09T00:00:00Z" });
    render(<UI />); const control = screen.getByRole("switch", { name: "多智能体协作" });
    await waitFor(() => expect(control).toBeEnabled()); fireEvent.click(control);
    await waitFor(() => expect(control).toHaveAttribute("aria-checked", "false"));
    expect(mocks.update).toHaveBeenCalledWith({ collaboration_enabled: false });
    expect(screen.queryByRole("button", { name: "讲解这个知识点" })).not.toBeInTheDocument(); expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "前往设置" })).toHaveAttribute("href", "/student/account");
  });
  it("keeps the previous value on a failed write and blocks a duplicate pending write", async () => {
    let rejectWrite!: (error: Error) => void;
    mocks.update.mockReturnValue(new Promise((_, reject) => { rejectWrite = reject; })); render(<UI />);
    const control = screen.getByRole("switch", { name: "图解讲题" }); await waitFor(() => expect(control).toBeEnabled());
    fireEvent.click(control); fireEvent.click(control); expect(mocks.update).toHaveBeenCalledTimes(1); expect(control).toBeDisabled();
    rejectWrite(new Error("offline")); expect(await screen.findByRole("alert")).toHaveTextContent("保存失败"); expect(control).toHaveAttribute("aria-checked", "true");
  });
  it("explains each selected agent and supports both graphic types and node selection", async () => {
    render(<UI />); fireEvent.click(screen.getByRole("button", { name: /诊断智能体/ }));
    expect(screen.getByRole("heading", { name: "诊断智能体" })).toBeInTheDocument(); expect(screen.getByRole("link", { name: "打开错题复习" })).toHaveAttribute("href", "/student/mistakes");
    fireEvent.click(screen.getByRole("button", { name: "结构图" }));
    fireEvent.click(screen.getByRole("button", { name: "软件系统" }));
    expect(screen.getByText("包括系统软件和应用软件。操作系统属于系统软件。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "软件系统" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "流程图" })); expect(screen.getByText("一条指令如何被取出")).toBeInTheDocument(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("does not reuse another account's pending preference response", async () => {
    let resolveFirst!: (value: typeof DEFAULT_STUDENT_AI_PREFERENCES) => void;
    mocks.get.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce({ ...DEFAULT_STUDENT_AI_PREFERENCES, collaboration_enabled: false });
    const view = render(<UI />); mocks.accountId = "student-two"; view.rerender(<UI />);
    const control = screen.getByRole("switch", { name: "多智能体协作" }); await waitFor(() => expect(control).toBeEnabled());
    resolveFirst(DEFAULT_STUDENT_AI_PREFERENCES); await waitFor(() => expect(control).toHaveAttribute("aria-checked", "false")); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("does not describe unreadable preferences as an intentional switch-off", async () => {
    mocks.get.mockRejectedValue(new Error("offline"));
    render(<UI />);
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取");
    expect(screen.getAllByText("读取失败")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "多智能体协作" })).toBeDisabled();
    expect(screen.queryByText("AI 多智能体协作已关闭。")).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("shows a diagram from the actual explanation response only when graphics are enabled", async () => {
    mocks.invoke.mockResolvedValue({ contract_version: "0.2", request_id: "diagram-1", capability: "explain", slot: "contextual_explanation", status: "ready", display_blocks: [{ block_id: "b1", kind: "summary", title: "取指", content: "根据地址读取指令。" }], diagram: { kind: "flow", title: "本题取指过程", summary: "地址与指令流向", nodes: [{ id: "a", label: "发出地址", description: "PC 提供待取指令地址。" }, { id: "b", label: "读出指令", description: "从主存读出。" }], edges: [{ from: "a", to: "b" }] }, citations: [], evidence_refs: [], next_actions: [], failure: null });
    mocks.update.mockResolvedValue({ ...DEFAULT_STUDENT_AI_PREFERENCES, visual_explanations_enabled: false });
    render(<UI />); fireEvent.click(await screen.findByRole("button", { name: "讲解这个知识点" }));
    expect(await screen.findByText("本题取指过程")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "图解讲题" })); await waitFor(() => expect(screen.queryByText("本题取指过程")).not.toBeInTheDocument());
    expect(screen.getByText("根据地址读取指令。")).toBeInTheDocument();
  });
});
