import {
  ArrowRight,
  FolderOpen,
  Plus,
  Trash2,
  Pencil,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { StudyCollection, StudyCollectionDetail } from "@xuetu/contracts";
import { useAuth } from "../auth/auth-context";
import { studyLibraryApi as api } from "./study-library-api";
import { StudyToolsNav, studyError, studyQueueHref } from "./study-tools";

export function CollectionsPage() {
  const { account } = useAuth();
  return account ? <CollectionsWorkspace key={account.user_id} /> : null;
}
function CollectionsWorkspace() {
  const [params, setParams] = useSearchParams(),
    selected = params.get("collection");
  const [collections, setCollections] = useState<StudyCollection[]>([]),
    [detail, setDetail] = useState<StudyCollectionDetail | null>(null);
  const [name, setName] = useState(""),
    [rename, setRename] = useState(false),
    [renameName, setRenameName] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setLoading(true);
    setDetail(null);
    setRename(false);
    void Promise.all([
      api.collections(c.signal),
      selected ? api.collection(selected, c.signal) : Promise.resolve(null),
    ])
      .then(([a, b]) => {
        if (!c.signal.aborted) {
          setCollections(a.items);
          setDetail(b);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(studyError(e));
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [selected, revision]);
  async function action(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      setRevision((r) => r + 1);
    } catch (e) {
      setError(studyError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <span className="study-eyebrow">我的练习收藏</span>
          <h1>专题题本</h1>
        </div>
        <Link className="study-quiet-link" to="/student/question-map">
          去地图选题
          <ArrowRight size={17} />
        </Link>
      </header>
      <StudyToolsNav />
      {error ? (
        <p className="study-error" role="alert">
          {error}
          <button onClick={() => setRevision((r) => r + 1)}>重新读取</button>
        </p>
      ) : null}
      <div className="study-collections-layout">
        <aside className="study-card study-collection-sidebar">
          <header>
            <h2>我的题本</h2>
            <span>{collections.length} 本</span>
          </header>
          <form
            className="study-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const { collection } = await api.saveCollection(
                  crypto.randomUUID(),
                  { name, version: 0 },
                );
                setName("");
                setParams({ collection: collection.id });
              });
            }}
          >
            <input
              aria-label="新题本名称"
              placeholder="新题本名称"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
            <button
              aria-label="创建题本"
              className="study-primary"
              disabled={busy || !name.trim()}
            >
              <Plus size={18} />
            </button>
          </form>
          <button
            className={`study-collection-link ${!selected ? "selected" : ""}`}
            onClick={() => setParams({})}
          >
            <FolderOpen size={20} />
            <span>全部题本</span>
            <b>{collections.length}</b>
          </button>
          {collections.map((c) => (
            <button
              className={`study-collection-link ${selected === c.id ? "selected" : ""}`}
              key={c.id}
              onClick={() => setParams({ collection: c.id })}
            >
              <FolderOpen size={20} />
              <span>{c.name}</span>
              <b>{c.count}</b>
            </button>
          ))}
        </aside>
        <main>
          {loading ? (
            <section className="study-card study-empty" role="status">
              正在读取题本…
            </section>
          ) : detail ? (
            <section className="study-card study-collection-detail">
              <header>
                <div>
                  <h2>{detail.collection.name}</h2>
                  <p>
                    {detail.questions.length} 道可练题目
                    {detail.unavailable
                      ? ` · ${detail.unavailable} 道暂不可练`
                      : ""}
                  </p>
                </div>
                <div className="study-row-actions">
                  <button
                    aria-label="重命名题本"
                    disabled={busy}
                    onClick={() => {
                      setRename((v) => !v);
                      setRenameName(detail.collection.name);
                    }}
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    aria-label="删除题本"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm("删除这个题本？题目和作答记录会保留。")
                      )
                        void action(async () => {
                          await api.removeCollection(
                            detail.collection.id,
                            detail.collection.version,
                          );
                          setParams({});
                        });
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                  {detail.questions[0] ? (
                    <Link
                      className="study-primary"
                      to={studyQueueHref(
                        detail.questions[0],
                        "collection",
                        detail.collection.id,
                      )}
                    >
                      开始复习
                      <ArrowRight size={16} />
                    </Link>
                  ) : null}
                </div>
              </header>
              {rename ? (
                <form
                  className="study-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await api.saveCollection(detail.collection.id, {
                        name: renameName,
                        version: detail.collection.version,
                      });
                      setRename(false);
                      setRenameName("");
                    });
                  }}
                >
                  <input
                    aria-label="题本新名称"
                    value={renameName}
                    maxLength={60}
                    onChange={(e) => setRenameName(e.target.value)}
                  />
                  <button
                    className="study-primary"
                    disabled={busy || !renameName.trim()}
                  >
                    保存名称
                  </button>
                </form>
              ) : null}
              {detail.questions.length ? (
                <>
                  <label className="study-search">
                    <Search size={17} />
                    <input
                      aria-label="搜索题本题目"
                      placeholder="搜索题干、学科或考点"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <ol className="study-question-list">
                    {detail.questions
                      .filter((q) =>
                        [q.excerpt, q.subject, ...q.topics.map((t) => t.title)]
                          .join(" ")
                          .toLocaleLowerCase()
                          .includes(search.toLocaleLowerCase()),
                      )
                      .map((q) => (
                        <li key={q.id}>
                          <div>
                            <span className="study-question-meta">
                              {q.subject} ·{" "}
                              {q.year ? `${q.year} 年` : "专项练习"} · 第{" "}
                              {q.number} 题
                            </span>
                            <Link
                              to={studyQueueHref(
                                q,
                                "collection",
                                detail.collection.id,
                              )}
                            >
                              {q.excerpt}
                            </Link>
                            <div className="study-tags">
                              {q.topics.slice(0, 3).map((t) => (
                                <span key={t.id}>{t.title}</span>
                              ))}
                            </div>
                          </div>
                          <button
                            disabled={busy}
                            aria-label={`移除第${q.number}题`}
                            onClick={() =>
                              void action(async () => {
                                await api.setMembership(
                                  detail.collection.id,
                                  q.id,
                                  false,
                                );
                              })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </li>
                      ))}
                  </ol>
                </>
              ) : (
                <div className="study-empty">
                  <FolderOpen size={42} />
                  <h2>给这个专题收几道题</h2>
                  <Link className="study-primary" to="/student/question-map">
                    去题目地图
                  </Link>
                </div>
              )}
            </section>
          ) : collections.length ? (
            <div className="study-collection-cards">
              {collections.map((c) => (
                <Link
                  key={c.id}
                  to={`?collection=${encodeURIComponent(c.id)}`}
                  className="study-card study-folder-card"
                >
                  <div className="study-folder-mark">
                    <FolderOpen size={32} />
                  </div>
                  <h2>{c.name}</h2>
                  <span>
                    {c.count} 道题目
                    <ArrowRight size={18} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <section className="study-card study-empty">
              <div className="study-folder-mark">
                <FolderOpen size={42} />
              </div>
              <h2>把同类题，放到一起</h2>
              <p>从左侧新建题本，再到题目页点击「加入题本」。</p>
              <Link to="/student/notebook?filter=bookmarks">
                查看已有收藏
                <ArrowRight size={16} />
              </Link>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
