import { questionNotebookId, type NotebookEntry, type NotebookWrite, type QuestionDto } from "@xuetu/contracts";
import { Bookmark, BookOpen, Check, Eye, FilePenLine, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { getNotebookEntry, removeNotebookEntry, saveNotebookEntry } from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { NOTEBOOK_ENTRY_CHANGED, clearNotebookDraft, clearSubmittedNotebookDraft, readNotebookDraft, writeNotebookDraft } from "./notebook-draft";
import "./notebook.css";
import { CollectionPicker } from "../study-library/study-tools";

const subjects: NotebookWrite["subject"][] = ["通用", "数据结构", "组成原理", "操作系统", "计算机网络"];
function writeFromEntry(entry: NotebookEntry): NotebookWrite {
  return { title: entry.title, content: entry.content, subject: entry.subject, question_id: entry.question_id, bookmarked: entry.bookmarked, version: entry.version };
}
function emptyNote(question?: QuestionDto): NotebookWrite {
  const rawSubject = question?.subject === "计算机组成原理" ? "组成原理" : question?.subject;
  const subject = subjects.includes(rawSubject as NotebookWrite["subject"]) ? rawSubject as NotebookWrite["subject"] : "通用";
  return { title: question ? `${question.year ? `${question.year}年` : "自编题"} · 第${question.number}题 · ${subject}` : "", content: "", subject, question_id: question?.id ?? null, bookmarked: false, version: 0 };
}
interface Props { id: string; owner: string; question?: QuestionDto; compact?: boolean; onRemoved?: () => void }

export function NotebookEditor({ id, owner, question, compact = false, onRemoved }: Props) {
  const [saved, setSaved] = useState<NotebookEntry | null>(null);
  const [draft, setDraft] = useState<NotebookWrite>(() => emptyNote(question));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(!compact);
  const [preview, setPreview] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setLoadFailed(false);
    getNotebookEntry(id, controller.signal).then(({ entry }) => {
      if (controller.signal.aborted) return;
      const local = readNotebookDraft(owner, id);
      setSaved(entry); setDraft(local ?? (entry ? writeFromEntry(entry) : emptyNote(question)));
      setDirty(Boolean(local)); setNotice(local ? "已恢复未保存的草稿" : "");
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "笔记读取失败，请重试。"); setLoading(false); setLoadFailed(true);
    });
    return () => controller.abort();
  }, [id, owner, loadKey]); // The keyed editor isolates each question and account.

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(change: Partial<NotebookWrite>) {
    const next = { ...draft, ...change }; setDraft(next); setDirty(true); setNotice("");
    try { writeNotebookDraft(owner, id, next); }
    catch { setError("草稿暂时无法留在浏览器，请点击保存笔记。" ); }
  }
  async function save(change: Partial<NotebookWrite> = {}) {
    if (inFlight.current || loadFailed || loading) return;
    inFlight.current = true; setSaving(true); setError(null); setNotice("");
    const next = { ...draft, ...change };
    try {
      const { entry } = await saveNotebookEntry(id, next);
      try { clearSubmittedNotebookDraft(owner, id, draft); } catch { /* The server save remains valid. */ }
      window.dispatchEvent(new Event(NOTEBOOK_ENTRY_CHANGED));
      if (!mounted.current) return;
      setSaved(entry); setDraft(writeFromEntry(entry)); setDirty(false);
      setNotice("bookmarked" in change ? entry.bookmarked ? "已收藏到题本" : "已取消收藏，笔记保留" : "笔记已保存");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "保存失败，草稿已保留，请重试。");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  function reload() {
    if (dirty && !window.confirm("重新读取会替换当前未保存的草稿，是否继续？")) return;
    try { clearNotebookDraft(owner, id); } catch { setError("无法清除旧草稿，请先复制正文。" ); return; }
    setDirty(false); setLoadKey((value) => value + 1);
  }
  async function remove() {
    if (!saved || inFlight.current || !window.confirm("删除这条记录及其笔记、收藏，是否继续？")) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      await removeNotebookEntry(saved.id, saved.version);
      try { clearSubmittedNotebookDraft(owner, id, draft); } catch { /* Deletion already completed. */ }
      window.dispatchEvent(new Event(NOTEBOOK_ENTRY_CHANGED));
      if (!mounted.current) return;
      setSaved(null); setDraft(emptyNote(question)); setDirty(false); setNotice("记录已删除"); onRemoved?.();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "删除失败，请重试。"); }
    finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  const source = saved?.question;
  const hasQuestion = Boolean(question || source);
  const disabled = loading || saving || loadFailed;
  return (
    <section className={`notebook-editor${compact ? " is-inline" : ""}`} aria-label={compact ? "本题笔记与收藏" : "笔记编辑器"}>
      <header className="notebook-editor-toolbar">
        <div>
          {question || source ? <CollectionPicker key={`${owner}:${question?.id ?? source!.id}`} questionId={question?.id ?? source!.id} /> : null}
          {saved?.content.trim() ? <Link to={`/student/memory-cards?from_note=${encodeURIComponent(saved.id)}`}>做成记忆卡</Link> : null}
          {hasQuestion ? <button aria-pressed={draft.bookmarked} className={draft.bookmarked ? "is-bookmarked" : ""} disabled={disabled || !draft.title.trim()} onClick={() => void save({ bookmarked: !draft.bookmarked })} type="button"><Bookmark aria-hidden="true" size={16} fill={draft.bookmarked ? "currentColor" : "none"} />{draft.bookmarked ? "已收藏" : "收藏本题"}</button> : <span><FilePenLine size={17} aria-hidden="true" />私人笔记</span>}
          {compact ? <button aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} type="button"><FilePenLine aria-hidden="true" size={16} />{expanded ? "收起笔记" : draft.content.trim() ? "查看笔记" : "记笔记"}</button> : null}
        </div>
        <Link to="/student/notebook"><BookOpen size={16} aria-hidden="true" />我的笔记本</Link>
      </header>
      {error ? <div role="alert" className="notebook-error"><span>{error}</span><button type="button" onClick={reload} disabled={saving}>重新读取</button></div> : null}
      {notice ? <p className="notebook-notice" role="status"><Check size={14} aria-hidden="true" />{notice}</p> : null}
      {expanded ? loading ? <p className="notebook-loading" role="status">正在读取笔记…</p> : (
        <div className="notebook-edit-body">
          {source && !compact ? <div className="notebook-source"><span>关联题目 · {source.subject}{source.year ? ` · ${source.year}年` : ""}</span><p>{source.excerpt}</p><Link to={source.href}>回到原题 →</Link></div> : null}
          <div className="notebook-title-fields">
            <label>笔记标题<input aria-label="笔记标题" disabled={disabled} maxLength={120} onChange={(event) => edit({ title: event.target.value })} placeholder="给这次复盘起个名字" value={draft.title} /></label>
            <label>学科<select aria-label="笔记学科" disabled={disabled || hasQuestion} value={draft.subject} onChange={(event) => edit({ subject: event.target.value as NotebookWrite["subject"] })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
          </div>
          <div className="notebook-format-bar"><span>{dirty ? "草稿未保存" : saved ? "已保存到我的账号" : "记录思路、错因和下次提醒"}</span><button aria-pressed={preview} type="button" onClick={() => setPreview((value) => !value)}><Eye aria-hidden="true" size={14} />{preview ? "继续编辑" : "预览"}</button></div>
          {preview ? <div className="notebook-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[图片：{alt || "图片"}]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{draft.content || "还没有写正文。"}</ReactMarkdown></div> : <textarea aria-label="笔记正文" disabled={disabled} maxLength={20000} onChange={(event) => edit({ content: event.target.value })} placeholder={hasQuestion ? "当时怎么想的？错在哪一步？下次遇到同类题先检查什么？" : "写下理解、例子或疑问，支持 Markdown。"} rows={compact ? 6 : 14} value={draft.content} />}
          <footer className="notebook-edit-actions"><span>{draft.content.length} / 20000</span><div>{saved && !compact ? <button className="notebook-delete" disabled={saving} onClick={() => void remove()} type="button"><Trash2 size={15} aria-hidden="true" />删除记录</button> : null}<button className="notebook-primary" disabled={disabled || !draft.title.trim() || (!draft.content.trim() && !draft.bookmarked)} onClick={() => void save()} type="button"><Save size={15} aria-hidden="true" />{saving ? "正在保存…" : "保存笔记"}</button></div></footer>
        </div>
      ) : null}
    </section>
  );
}

export function QuestionNotebookTools({ question }: { question: QuestionDto }) {
  const { account } = useAuth();
  return account ? <NotebookEditor compact id={questionNotebookId(question.id)} key={`${account.user_id}:${question.id}`} owner={account.user_id} question={question} /> : null;
}
