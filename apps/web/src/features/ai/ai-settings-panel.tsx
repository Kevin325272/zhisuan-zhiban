import type { LearningDiagram } from "@xuetu/contracts";
import { ArrowRight, BookOpen, ChartNoAxesCombined, Check, GitBranch, HeartHandshake, Network, Route, ScanSearch, Sparkles, Waypoints } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAiPreferences } from "./ai-preferences-context";
import { LearningDiagramView } from "./learning-diagram";

const AGENTS = [
  { id: "plan", name: "规划智能体", short: "安排下一步", icon: Route, when: "查看学习安排时", detail: "结合目标、课程进度和待复习内容，解释为什么先学这一项，帮你找到当天的起点。", input: "学习目标 · 课程进度 · 待复习内容", output: "学习顺序与行动建议", href: "/student/home", action: "查看学习面板" },
  { id: "explain", name: "讲解智能体", short: "把概念讲明白", icon: BookOpen, when: "学习课程知识点时", detail: "围绕当前课程内容解释概念。开启图解后，可用流程和结构关系帮助理解抽象过程。", input: "当前知识点 · 课程片段", output: "概念讲解与知识图解", href: "/student/courses", action: "进入课程学习" },
  { id: "coach", name: "引导智能体", short: "拆解解题思路", icon: Waypoints, when: "查看课程案例时", detail: "将案例拆成可以逐步思考的小问题，在你卡住的地方给出提示，帮助形成自己的解题步骤。", input: "课程案例 · 当前疑问", output: "分步提示与思考问题", href: "/student/courses", action: "查看课程案例" },
  { id: "diagnose", name: "诊断智能体", short: "找到出错原因", icon: ScanSearch, when: "提交练习之后", detail: "结合这次作答和评测结果解释可能的错因，给出下一步提示，帮助你理解为什么错。", input: "题目 · 本次作答 · 评测结果", output: "错因反馈与重练提示", href: "/student/mistakes", action: "打开错题复习" },
  { id: "profile", name: "画像智能体", short: "看清学习重点", icon: ChartNoAxesCombined, when: "生成学习解读时", detail: "把不同课程的学习记录整理成优势、薄弱环节与下一步建议，帮助你读懂自己的学习变化。", input: "课程进度 · 作答与复习记录", output: "学习画像解读", href: "/student/profile", action: "查看学习分析" },
  { id: "care", name: "关怀智能体", short: "陪你调整节奏", icon: HeartHandshake, when: "你主动进入关怀交流时", detail: "围绕你表达的感受与当前学习任务提供支持，帮助你选择继续、放轻任务或稍作休息。", input: "你愿意分享的感受 · 当前任务", output: "支持性交流与轻量建议", href: "/student/home?care_preview=1", action: "体验关怀互动" },
] as const;

const EXAMPLES: Record<"flow" | "structure", LearningDiagram> = {
  flow: { kind: "flow", title: "一条指令如何被取出", summary: "从程序计数器给出地址，到指令进入指令寄存器。", nodes: [
    { id: "pc", label: "PC 提供地址", description: "程序计数器保存待取指令地址，将该地址送入存储器地址寄存器 MAR。" },
    { id: "memory", label: "读取主存", description: "控制器发出读信号，主存将对应地址的指令送入存储器数据寄存器 MDR。" },
    { id: "ir", label: "指令送入 IR", description: "MDR 中的指令送入指令寄存器 IR，随后由控制器译码。" },
  ], edges: [{ from: "pc", to: "memory", label: "指令地址" }, { from: "memory", to: "ir", label: "指令内容" }] },
  structure: { kind: "structure", title: "计算机系统的基本组成", summary: "硬件提供物理基础，软件组织并控制硬件完成任务。", nodes: [
    { id: "system", label: "计算机系统", description: "计算机系统由硬件系统和软件系统共同组成，二者配合完成信息处理。" },
    { id: "hardware", label: "硬件系统", description: "包括运算器、控制器、存储器、输入设备和输出设备。" },
    { id: "software", label: "软件系统", description: "包括系统软件和应用软件。操作系统属于系统软件。" },
  ], edges: [{ from: "system", to: "hardware", label: "物理设备" }, { from: "system", to: "software", label: "程序与数据" }] },
};

export function AiSettingsPanel() {
  const { preferences, status, saving, error, update, reload } = useAiPreferences();
  const [selectedId, setSelectedId] = useState<string>("explain");
  const [preview, setPreview] = useState<"flow" | "structure">("flow");
  const selected = AGENTS.find((agent) => agent.id === selectedId)!;
  const enabled = status === "ready" && preferences.collaboration_enabled;
  const busy = saving || status !== "ready";
  const switchStatus = (value: boolean) => status === "loading" ? "读取中" : status === "error" ? "读取失败" : saving ? "保存中" : value ? "已开启" : "已关闭";
  return <div className="ai-settings">
    <section className={`ai-master-card${enabled ? " is-enabled" : ""}`} aria-labelledby="ai-master-title">
      <span className="settings-feature-icon"><Network size={25} /></span>
      <div><h2 id="ai-master-title">多智能体协作</h2><p>围绕你的学习进度，协同提供规划、讲解与复盘。</p></div>
      <div className="settings-switch-control"><span>{switchStatus(enabled)}</span><button className="settings-switch" role="switch" aria-label="多智能体协作" aria-checked={enabled} disabled={busy} onClick={() => void update({ collaboration_enabled: !preferences.collaboration_enabled })} type="button"><span /></button></div>
    </section>
    {error ? <p className="settings-feedback is-error" role="alert">{error}{status === "error" ? <button onClick={reload} type="button">重新读取</button> : null}</p> : <p className="settings-feedback" role="status"><Check size={15} />{preferences.updated_at ? "偏好已保存，重新登录后仍会保留。" : "关闭后，这些学习角色将暂停协作。课程与学习记录仍可使用。"}</p>}
    <section className="agent-map-card" aria-labelledby="agent-map-title">
      <header className="settings-section-heading"><div><h2 id="agent-map-title">认识你的学习团队</h2><p>点击角色，了解它在什么时候、怎样帮助你。</p></div><span className="settings-badge">6 个学习角色</span></header>
      <div className={`agent-map-workspace${enabled ? "" : " is-paused"}`}>
        <div className="agent-map">
          <svg viewBox="0 0 680 340" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M 178 57 C 310 57 275 170 340 170 M 178 170 H 340 M 178 283 C 310 283 275 170 340 170 M 502 57 C 370 57 405 170 340 170 M 502 170 H 340 M 502 283 C 370 283 405 170 340 170" /></g><circle cx="340" cy="170" r="70" fill="none" stroke="currentColor" strokeDasharray="3 7" /></svg>
          <div className="agent-map-hub"><Sparkles size={24} /><strong>你的学习</strong><span>记录连接每一步</span></div>
          {AGENTS.map((agent, index) => <button className={`agent-node agent-node-${index + 1}`} type="button" key={agent.id} aria-pressed={selectedId === agent.id} onClick={() => setSelectedId(agent.id)}><span className="agent-node-icon"><agent.icon size={21} /></span><span><strong>{agent.name}</strong><small>{agent.short}</small></span></button>)}
          <span className="agent-map-caption">{enabled ? "按学习场景协作" : "协作已暂停 · 可继续了解各角色"}</span>
        </div>
        <div className="agent-role-detail" aria-live="polite"><span className="agent-role-kicker">{selected.when}</span><h3><selected.icon size={22} />{selected.name}</h3><p>{selected.detail}</p><dl><div><dt>了解什么</dt><dd>{selected.input}</dd></div><div><dt>带来什么</dt><dd>{selected.output}</dd></div></dl><Link to={selected.href}>{selected.action}<ArrowRight size={16} /></Link></div>
      </div>
    </section>
    <section className="diagram-settings-card" aria-labelledby="diagram-settings-title">
      <header className="settings-section-heading"><div><h2 id="diagram-settings-title"><GitBranch size={21} />图解讲题</h2><p>把过程画成流程图，把组成与联系画成结构图。</p></div><div className="settings-switch-control"><span>{switchStatus(preferences.visual_explanations_enabled)}</span><button className="settings-switch" role="switch" aria-label="图解讲题" aria-checked={preferences.visual_explanations_enabled} disabled={busy} onClick={() => void update({ visual_explanations_enabled: !preferences.visual_explanations_enabled })} type="button"><span /></button></div></header>
      <div className="diagram-preview-heading"><span>图解预览</span><div role="group" aria-label="图解预览类型"><button type="button" aria-pressed={preview === "flow"} onClick={() => setPreview("flow")}><Route size={15} />流程图</button><button type="button" aria-pressed={preview === "structure"} onClick={() => setPreview("structure")}><GitBranch size={15} />结构图</button></div></div>
      <LearningDiagramView key={preview} diagram={EXAMPLES[preview]} />
      <p className="settings-preview-note">预览可点击查看。实际讲题时，图解会围绕当前知识点生成；关闭后使用文字讲解。</p>
    </section>
  </div>;
}
