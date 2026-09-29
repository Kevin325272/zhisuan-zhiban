import {
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Code2,
  FileText,
  Files,
  Layers,
  Notebook,
  Quote,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DemoDataBadge } from "../../components/demo-data-badge";
import {
  addGeneratedReviewCard,
  loadLearningOutputs,
  saveMaterialNote,
  saveUploadedMaterial,
  type UploadedMaterial,
} from "../../lib/learning-output-store";

interface MaterialSource {
  id: string;
  kind: string;
  title: string;
  meta: string;
  sync: string;
  icon: LucideIcon;
  reference: string;
  claim: string;
  reader: {
    title: string;
    confidence: string;
    markerLabel: string;
    markerValue: string;
    markerMeta: string;
    breadcrumb: string;
    heading: string;
    quote: string;
    explanation: string;
  };
}

const builtInSources: MaterialSource[] = [
  {
    id: "textbook",
    kind: "教材",
    title: "数据结构（C++版）",
    meta: "第 6 章 · 图",
    sync: "已索引 186 段",
    icon: BookOpen,
    reference: "教材 · P143",
    claim: "顶点入队时完成访问标记",
    reader: {
      title: "教材原文定位",
      confidence: "0.93",
      markerLabel: "PAGE",
      markerValue: "143",
      markerMeta: "6.2.1",
      breadcrumb: "第 6 章 图 → 图的遍历 → 广度优先搜索",
      heading: "广度优先遍历中的访问标记",
      quote: "顶点进入待访问队列时即应完成访问标记，避免同一顶点被其他邻接点重复加入队列。",
      explanation: "这一约束直接解释了当前代码在“重复边输入”下产生重复节点的原因。",
    },
  },
  {
    id: "slides",
    kind: "课程课件",
    title: "06 图与图遍历",
    meta: "48 页 · 课堂重点",
    sync: "已索引 72 段",
    icon: Layers,
    reference: "课程课件 · P27",
    claim: "发现顶点后先标记再入队",
    reader: {
      title: "课件重点定位",
      confidence: "0.91",
      markerLabel: "SLIDE",
      markerValue: "27",
      markerMeta: "课堂重点",
      breadcrumb: "06 图与图遍历 → BFS 算法流程 → visited 标记",
      heading: "BFS 的队列状态变化",
      quote: "发现一个尚未访问的邻接顶点后，应先记录其访问状态，再将该顶点加入待访问队列。",
      explanation: "课件把“标记”放在“入队”之前，强调同一顶点只能进入一次等待处理状态。",
    },
  },
  {
    id: "guide",
    kind: "实验指导",
    title: "实验五 BFS / DFS",
    meta: "实验目标与验收",
    sync: "已索引 31 段",
    icon: Code2,
    reference: "实验指导 · 2.3",
    claim: "输出序列不得含重复顶点",
    reader: {
      title: "实验要求定位",
      confidence: "0.89",
      markerLabel: "SECTION",
      markerValue: "2.3",
      markerMeta: "验收项",
      breadcrumb: "实验五 BFS / DFS → BFS 实现 → 输出约束",
      heading: "BFS 输出不得包含重复顶点",
      quote: "遍历结果中的每个顶点只能出现一次，并应正确处理重复边、自环与非连通图输入。",
      explanation: "该验收条件把 visited 标记时机转化为可运行测试：一旦重复入队，输出序列就会违反约束。",
    },
  },
  {
    id: "notes",
    kind: "个人笔记",
    title: "图遍历错因笔记",
    meta: "7 月 22 日更新",
    sync: "已索引 12 段",
    icon: Notebook,
    reference: "个人笔记 · 错因 04",
    claim: "出队后标记会产生重复入队",
    reader: {
      title: "错因笔记定位",
      confidence: "0.87",
      markerLabel: "NOTE",
      markerValue: "04",
      markerMeta: "7 / 22",
      breadcrumb: "图遍历错因笔记 → 重复入队 → 标记时机",
      heading: "出队后标记为什么会重复入队",
      quote: "节点 3 尚未出队时，可能先后被节点 1 和节点 2 发现；若此时仍未标记，它就会被加入队列两次。",
      explanation: "这条笔记记录了错误状态的完整因果链，可直接回到当前 BFS 代码进行对照。",
    },
  },
];

function uploadedMaterialToSource(material: UploadedMaterial): MaterialSource {
  const extension = material.title.split(".").pop()?.toUpperCase() ?? "FILE";
  const segmentCount = Math.max(1, Math.ceil(Math.max(material.excerpt.length, 80) / 120));
  return {
    id: material.id,
    kind: "上传资料",
    title: material.title,
    meta: `${extension} · ${(material.size / 1024).toFixed(1)} KB`,
    sync: `已索引 ${segmentCount} 段`,
    icon: FileText,
    reference: `上传资料 · ${material.title}`,
    claim: "已纳入当前学习任务的多来源核对",
    reader: {
      title: "上传资料定位",
      confidence: "0.84",
      markerLabel: "FILE",
      markerValue: extension,
      markerMeta: "本地导入",
      breadcrumb: `${material.title} → 自动切片 → 当前命中片段`,
      heading: material.title.replace(/\.[^.]+$/, ""),
      quote: material.excerpt || "文件已完成本地索引，可与教材、课件和实验指导共同参与生成。",
      explanation: "该资料仅保存在当前浏览器，用于演示学生自有材料进入学习闭环后的效果。",
    },
  };
}

const defaultSource = builtInSources[0]!;

type GeneratedMaterialOutput = "quiz" | "mindmap" | null;

export function MaterialsPage() {
  const initialOutputs = useMemo(() => loadLearningOutputs(), []);
  const [uploadedMaterials, setUploadedMaterials] = useState(initialOutputs.uploadedMaterials);
  const sources = useMemo(
    () => [...builtInSources, ...uploadedMaterials.map(uploadedMaterialToSource)],
    [uploadedMaterials],
  );
  const [searchParams] = useSearchParams();
  const requestedSourceId = searchParams.get("source");
  const initialSourceId = sources.some((source) => source.id === requestedSourceId)
    ? requestedSourceId!
    : "textbook";
  const [selectedId, setSelectedId] = useState(initialSourceId);
  const [includedSourceIds, setIncludedSourceIds] = useState<Set<string>>(
    () => new Set([initialSourceId]),
  );
  const [generatedCards, setGeneratedCards] = useState<Set<string>>(
    () => new Set(loadLearningOutputs().reviewCards.map((card) => card.sourceId)),
  );
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>(
    () => loadLearningOutputs().notes,
  );
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [generatedOutput, setGeneratedOutput] = useState<GeneratedMaterialOutput>(null);
  const selected = sources.find((source) => source.id === selectedId) ?? defaultSource;
  const savedNote = savedNotes[selected.id];
  const includedSources = sources.filter((source) => includedSourceIds.has(source.id));
  const outputSourceKey = includedSources.map((source) => source.id).sort().join("+");
  const cardGenerated = generatedCards.has(outputSourceKey);

  const selectSource = (sourceId: string) => {
    setSelectedId(sourceId);
    setIncludedSourceIds((current) => current.size === 1 ? new Set([sourceId]) : current);
    setNoteEditorOpen(false);
    setGeneratedOutput(null);
  };

  const toggleIncludedSource = (sourceId: string) => {
    setIncludedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId) && next.size > 1) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
    setGeneratedOutput(null);
  };

  const uploadMaterials = async (files: FileList | null) => {
    if (!files?.length) return;
    const records: UploadedMaterial[] = [];
    for (const file of Array.from(files)) {
      let excerpt = "";
      if (/^text\//.test(file.type) || /\.(md|txt|json|jsonl|csv)$/i.test(file.name)) {
        try {
          excerpt = (await file.text()).replace(/\s+/g, " ").trim().slice(0, 260);
        } catch {
          excerpt = "文本内容将在索引服务可用后继续解析。";
        }
      }
      const record: UploadedMaterial = {
        id: `upload-${file.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")}`,
        title: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        excerpt,
        uploadedAt: new Date().toISOString(),
      };
      saveUploadedMaterial(record);
      records.push(record);
    }
    setUploadedMaterials((current) => [
      ...current.filter((item) => !records.some((record) => record.id === item.id)),
      ...records,
    ]);
    setIncludedSourceIds((current) => new Set([...current, ...records.map((record) => record.id)]));
    setSelectedId(records.at(-1)?.id ?? selectedId);
  };

  const openNoteEditor = () => {
    setNoteDraft(
      savedNote ??
        `错因链：重复边 → 重复入队 → visited 标记时机过晚。\n依据：${selected.reference}，${selected.claim}。`,
    );
    setNoteEditorOpen(true);
  };

  return (
    <div className="page-inner page-surface module-page materials-page readability-upgraded">
      <header className="cs-page-header module-page-header">
        <div>
          <p className="cs-workspace-kicker">课程材料</p>
          <h1>材料工作室<DemoDataBadge label="示例资料" /></h1>
          <p>面向学生聚合课程材料，让每次解释都能回到教材、课件或实验要求中的具体位置。</p>
        </div>
        <div className="material-sync-status"><i /><span><strong>{sources.length} 项已同步材料</strong><small>最近更新 8 分钟前</small></span></div>
      </header>

      <section aria-label="资料库学习上下文" className="materials-context-rail">
        <div>
           <small>01 / 材料</small>
          <h2>课程材料</h2>
          <p>{sources.length} 项课程资料，可选择、上传并回到原始位置。</p>
        </div>
        <div>
          <small>02 / 关联资料</small>
          <h2>知识关联</h2>
          <p>已选择 {includedSources.length} 个来源；回答中引用的资料会单独列出。</p>
        </div>
        <div>
           <small>03 / 继续</small>
          <h2>最近使用</h2>
          <p>{selected.title} · {selected.reference}</p>
          <a href="#active-material-reader">继续阅读当前材料</a>
        </div>
      </section>

      <section className="material-workspace" aria-label="课程材料工作区">
        <aside className="material-source-panel">
           <header><div><span>课程材料</span><strong>课程材料</strong></div><Files aria-hidden="true" size={17} /></header>
          <div className="material-source-list">
            {sources.map((source) => {
              const Icon = source.icon;
              return (
                <div className="material-source-item" key={source.id}>
                  <button
                    aria-pressed={selected.id === source.id}
                    className={selected.id === source.id ? "active" : ""}
                    onClick={() => selectSource(source.id)}
                    type="button"
                  >
                    <span><Icon aria-hidden="true" size={15} /></span>
                    <span><small>{source.kind}</small><strong>{source.title}</strong><i>{source.meta}</i></span>
                    <em>{source.sync}</em>
                  </button>
                  <label className="material-source-check" title="纳入本次生成">
                    <input
                      aria-label={`纳入生成：${source.title}`}
                      checked={includedSourceIds.has(source.id)}
                      onChange={() => toggleIncludedSource(source.id)}
                      type="checkbox"
                    />
                    <span><CheckCircle2 aria-hidden="true" size={13} /></span>
                  </label>
                </div>
              );
            })}
          </div>
          <label className="material-upload-control">
            <Upload aria-hidden="true" size={14} /> 上传课程资料
            <input
              accept=".txt,.md,.pdf,.json,.jsonl"
              aria-label="上传课程资料"
              multiple
              onChange={(event) => void uploadMaterials(event.target.files)}
              type="file"
            />
          </label>
          <footer><CheckCircle2 aria-hidden="true" size={13} /> 所有来源均可追溯</footer>
        </aside>

        <article aria-live="polite" className="material-reader" id="active-material-reader" key={selected.id}>
          <header>
            <div><span>{selected.kind} / {selected.meta}</span><h2>{selected.reader.title}</h2></div>
            <span className="source-confidence">资料匹配度 {selected.reader.confidence}</span>
          </header>
          <section className="material-anchor">
            <div className="material-page-marker">
              <span>{selected.reader.markerLabel}</span>
              <strong>{selected.reader.markerValue}</strong>
              <small>{selected.reader.markerMeta}</small>
            </div>
            <div>
              <p className="material-breadcrumb">{selected.reader.breadcrumb}</p>
              <h3>{selected.reader.heading}</h3>
              <blockquote>
                <Quote aria-hidden="true" size={17} />
                {selected.reader.quote}
              </blockquote>
              <p>{selected.reader.explanation}</p>
            </div>
          </section>
          <section className="source-cross-check">
            <header><span>跨来源核对</span><small>3 个来源结论一致</small></header>
            {sources
              .filter((source) => source.id !== selected.id)
              .map((source) => (
                <div key={source.id}>
                  <span>{source.reference}</span>
                  <strong>{source.claim}</strong>
                  <i>一致</i>
                </div>
              ))}
          </section>
        </article>

      </section>

        <section className="material-action-panel" aria-label="继续使用当前材料">
           <header><span>学习工具</span><strong>把材料变成练习</strong></header>
          <div className="material-selection-summary">
            <span>{includedSources.length}</span>
            <div><strong>已选择 {includedSources.length} 个来源</strong><small>生成内容将保留每条出处</small></div>
          </div>
          <section>
            <span className="material-action-icon"><Sparkles aria-hidden="true" size={18} /></span>
            <h3>生成概念学习卡</h3>
            <p>保留原始出处，并加入一组“标记时机”判断题。</p>
            <button
              type="button"
              onClick={() => {
                addGeneratedReviewCard({
                  id: `material-card-${outputSourceKey}`,
                  sourceId: outputSourceKey,
                  title: includedSources.length > 1
                    ? "BFS 标记时机多来源学习卡"
                    : `${selected.reader.heading}学习卡`,
                  course: "数据结构",
                  minutes: 8,
                  reason: `来源：${includedSources.map((source) => source.reference).join(" / ")}`,
                  href: `/student/materials?source=${selected.id}`,
                  scheduledFor: "2026-07-23",
                });
                setGeneratedCards((current) => new Set(current).add(outputSourceKey));
              }}
              disabled={cardGenerated}
            >
              {cardGenerated ? <CheckCircle2 aria-hidden="true" size={14} /> : <FileText aria-hidden="true" size={14} />}
              {cardGenerated ? "已生成学习卡片" : "生成学习卡片"}
            </button>
            {cardGenerated ? <small className="material-success">学习卡片已加入今日复习</small> : null}
          </section>
          <section className="material-output-actions">
            <button onClick={() => setGeneratedOutput("quiz")} type="button">
              <CircleHelp aria-hidden="true" size={14} /> 生成针对性测验
            </button>
            <button onClick={() => setGeneratedOutput("mindmap")} type="button">
              <BrainCircuit aria-hidden="true" size={14} /> 生成思维导图
            </button>
          </section>
          <section className="material-notes">
            <span className="material-action-icon"><Notebook aria-hidden="true" size={18} /></span>
            <h3>加入错因笔记</h3>
            <p>记录“重复边 → 重复入队 → 标记时机”的因果链。</p>
            {noteEditorOpen ? (
              <div className="material-note-editor">
                <label htmlFor="material-note-content">个人笔记内容</label>
                <textarea
                  id="material-note-content"
                  onChange={(event) => setNoteDraft(event.target.value)}
                  rows={5}
                  value={noteDraft}
                />
                <div>
                  <button className="secondary" onClick={() => setNoteEditorOpen(false)} type="button">取消</button>
                  <button
                    disabled={!noteDraft.trim()}
                    onClick={() => {
                      const saved = saveMaterialNote(selected.id, noteDraft.trim());
                      setSavedNotes(saved.notes);
                      setNoteEditorOpen(false);
                    }}
                    type="button"
                  >
                    保存笔记
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={openNoteEditor}>
                {savedNote ? "编辑个人笔记" : "写入个人笔记"}
              </button>
            )}
            {savedNote && !noteEditorOpen ? <small className="material-success">已写入个人笔记</small> : null}
          </section>
        </section>

      {generatedOutput === "quiz" ? (
        <section aria-label="多来源针对性测验" className="material-generated-output material-quiz-output">
          <header>
             <div><span>针对性练习</span><h2>多来源针对性测验</h2></div>
            <strong>{includedSources.length} 道判断题 · 来源可回查</strong>
          </header>
          <ol>
            {includedSources.map((source, index) => (
              <li key={source.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{source.claim}</strong><small>{source.reference}</small></div>
                <em>判断</em>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {generatedOutput === "mindmap" ? (
        <section aria-label="BFS 标记时机思维导图" className="material-generated-output material-mindmap-output">
           <header><span>思维导图</span><h2>BFS 标记时机思维导图</h2></header>
          <div className="material-mindmap-canvas">
            <div className="material-mindmap-root"><small>核心问题</small><strong>visited 应该何时标记？</strong></div>
            <div className="material-mindmap-branches">
              {includedSources.map((source) => (
                <article key={source.id}>
                  <small>{source.kind}</small>
                  <strong>{source.title}</strong>
                  <p>{source.claim}</p>
                  <span>{source.reference}</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
