import type { NotebookList, NotebookQuery } from "@xuetu/contracts";
import { ArrowLeft, ArrowRight, Bookmark, BookOpen, FilePenLine, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getNotebookEntries } from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { NotebookEditor } from "./notebook-editor";
import { NOTEBOOK_ENTRY_CHANGED, listNotebookDrafts } from "./notebook-draft";
import "./notebook.css";
import { StudyToolsNav } from "../study-library/study-tools";

const pageSize = 30;
const subjects = ["全部学科", "数据结构", "组成原理", "操作系统", "计算机网络", "通用"] as const;
export function NotebookPage() {
  const { account } = useAuth();
  return account ? <NotebookWorkspace key={account.user_id} owner={account.user_id} /> : null;
}
function NotebookWorkspace({ owner }: { owner: string }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<(typeof subjects)[number]>("全部学科");
  const filterParam = params.get("filter");
  const filter: NotebookQuery["filter"] = filterParam === "bookmarks" || filterParam === "notes" ? filterParam : "all";
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<NotebookList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [drafts, setDrafts] = useState(() => listNotebookDrafts(owner));
  const selectedId = params.get("entry");
  useEffect(() => {
    const refreshEntries = () => setRevision((value) => value + 1);
    window.addEventListener(NOTEBOOK_ENTRY_CHANGED, refreshEntries);
    return () => window.removeEventListener(NOTEBOOK_ENTRY_CHANGED, refreshEntries);
  }, []);
  useEffect(() => {
    const refresh = () => setDrafts(listNotebookDrafts(owner));
    window.addEventListener("xuetu-notebook-draft-change", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("xuetu-notebook-draft-change", refresh); window.removeEventListener("storage", refresh); };
  }, [owner]);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    getNotebookEntries({ search: query, subject: subject === "全部学科" ? undefined : subject, filter, limit: pageSize, offset }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result); setLoading(false);
      if (offset > 0 && offset >= result.total) setOffset(Math.max(0, Math.floor((result.total - 1) / pageSize) * pageSize));
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "笔记列表读取失败，请重试。"); setLoading(false);
    });
    return () => controller.abort();
  }, [query, subject, filter, offset, revision]);
  function select(id: string | null) {
    setParams((current) => { const next = new URLSearchParams(current); if (id) next.set("entry", id); else next.delete("entry"); return next; });
  }
  return (
    <div className="notebook-page">
      <StudyToolsNav />
      <header className="notebook-page-heading"><div><h1>复习笔记本</h1><p>留下思路，复习时少走弯路。</p></div>{selectedId || (data && data.notes_count + data.bookmarks_count > 0) ? <button className="notebook-primary" onClick={() => select(`note:${crypto.randomUUID()}`)} type="button"><Plus aria-hidden="true" size={18} />新建笔记</button> : null}</header>
      <div className="notebook-overview"><span><FilePenLine size={17} aria-hidden="true" />私人笔记<strong>{data ? data.notes_count : "—"}</strong></span><span><Bookmark size={17} aria-hidden="true" />收藏题目<strong>{data ? data.bookmarks_count : "—"}</strong></span><Link to="/student/practice">去题库积累 <ArrowRight size={15} aria-hidden="true" /></Link></div>
      <div className="notebook-workspace" data-editing={Boolean(selectedId)}>
        <aside className="notebook-library" aria-label="我的笔记列表">
          <label className="notebook-search"><Search aria-hidden="true" size={16} /><input aria-label="搜索笔记" maxLength={120} placeholder="搜索标题、正文或题干" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="notebook-filters"><select aria-label="筛选笔记学科" value={subject} onChange={(event) => { setSubject(event.target.value as (typeof subjects)[number]); setOffset(0); }}>{subjects.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="筛选笔记类型" value={filter} onChange={(event) => { const value = event.target.value as NotebookQuery["filter"]; setOffset(0); setParams((current) => { const next = new URLSearchParams(current); next.set("filter", value); return next; }, { replace: true }); }}><option value="all">全部记录</option><option value="notes">有笔记</option><option value="bookmarks">收藏题目</option></select></div>
          <div className="notebook-list-caption"><span>{query || subject !== "全部学科" ? "筛选结果" : "最近更新"}</span><span>{data?.total ?? 0} 条</span></div>
          {drafts.length ? <div className="notebook-drafts" aria-label="未保存的草稿"><span>未保存草稿 · 仅在当前浏览器</span>{drafts.map((draft) => <button key={draft.id} onClick={() => select(draft.id)} type="button">继续编辑 · {draft.title}</button>)}</div> : null}
          {error ? <div className="notebook-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>重试</button></div> : loading ? <p className="notebook-loading" role="status">正在整理笔记…</p> : data?.items.length ? <ul className="notebook-entry-list">{data.items.map((item) => <li key={item.id}><button aria-current={selectedId === item.id ? "true" : undefined} onClick={() => select(item.id)} type="button"><span className="notebook-entry-meta"><span>{item.subject}</span>{item.bookmarked ? <Bookmark size={13} aria-label="已收藏" fill="currentColor" /> : null}</span><strong>{item.title}</strong><p>{item.content.slice(0, 96) || item.question?.excerpt.slice(0, 96) || "还没有写正文"}</p><time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleDateString("zh-CN")} 更新</time></button></li>)}</ul> : <div className="notebook-list-empty"><BookOpen size={25} aria-hidden="true" /><strong>{query || subject !== "全部学科" || filter !== "all" ? "没有符合条件的记录" : "从一次复盘开始"}</strong><p>{query || subject !== "全部学科" || filter !== "all" ? "换个关键词或学科试试。" : "新建一条笔记，或在题目页收藏并记录思路。"}</p></div>}
          {data && data.total > pageSize ? <div className="notebook-pagination"><button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))} type="button">上一页</button><span>{Math.floor(offset / pageSize) + 1} / {Math.ceil(data.total / pageSize)}</span><button disabled={offset + pageSize >= data.total || loading} onClick={() => setOffset(offset + pageSize)} type="button">下一页</button></div> : null}
        </aside>
        <div className="notebook-content">{selectedId ? <><button className="notebook-back" type="button" onClick={() => select(null)}><ArrowLeft aria-hidden="true" size={15} />返回列表</button><NotebookEditor id={selectedId} key={`${owner}:${selectedId}`} owner={owner} onRemoved={() => select(null)} /></> : <section className="notebook-welcome"><div className="notebook-paper-stack" aria-hidden="true"><div><span>我的复习笔记</span><i /><i /><i /><FilePenLine size={32} strokeWidth={1.4} /></div></div><h2>{data && data.notes_count + data.bookmarks_count > 0 ? "继续整理你的思路" : "把这次想明白的，留给下次复习"}</h2><p>{data && data.notes_count + data.bookmarks_count > 0 ? "选择左侧笔记，接着记录。" : "记下易错之处、解题步骤，或一个突然想通的概念。"}</p>{data && data.notes_count + data.bookmarks_count > 0 ? null : <button className="notebook-primary" type="button" onClick={() => select(`note:${crypto.randomUUID()}`)}><Plus size={16} aria-hidden="true" />新建第一条笔记</button>}<div className="notebook-writing-prompts"><span>哪里容易错</span><span>关键的一步</span><span>下次怎么做</span></div></section>}</div>
      </div>
    </div>
  );
}
