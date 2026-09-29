import type {
  MemoryCard,
  MemoryCardWrite,
  MemoryReview,
  MemoryToday,
} from "@xuetu/contracts";
import {
  BookOpen,
  CheckCheck,
  Clock3,
  Eye,
  Layers3,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, getNotebookEntry } from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { studyLibraryApi as api } from "./study-library-api";
import { StudyToolsNav, studyError } from "./study-tools";
import { MemoryCardEditor } from "./memory-card-editor";
import { CardContent } from "./card-content";

const ratings = [
  ["again", "忘记了"],
  ["hard", "有点困难"],
  ["good", "记得"],
  ["easy", "很熟悉"],
] as const;
export function MemoryReviewCard({
  card,
  busy,
  onRate,
}: {
  card: MemoryCard;
  busy: boolean;
  onRate: (rating: MemoryReview["rating"]) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <article className={`study-recall-card ${revealed ? "revealed" : ""}`}>
      <div className="study-recall-meta">
        <span>{card.subject}</span>
        <span>{card.reviews ? `已复习 ${card.reviews} 次` : "新卡片"}</span>
      </div>
      <CardContent text={card.front} />
      {revealed ? (
        <section className="study-recall-answer" aria-label="卡片答案">
          <span>参考答案</span>
          <CardContent text={card.back} />
        </section>
      ) : (
        <div className="study-recall-cover">
          <Layers3 size={48} strokeWidth={1.2} />
          <button
            className="study-primary"
            disabled={busy}
            onClick={() => setRevealed(true)}
          >
            <Eye size={18} />
            翻开答案
          </button>
        </div>
      )}
      <footer className="study-recall-ratings">
        {ratings.map(([rating, label]) => (
          <button
            key={rating}
            className={`rating-${rating}`}
            disabled={!revealed || busy}
            onClick={() => onRate(rating)}
          >
            {label}
          </button>
        ))}
      </footer>
    </article>
  );
}
function MemoryWorkspace() {
  const [params, setParams] = useSearchParams();
  const fromNote = params.get("from_note");
  const [cards, setCards] = useState<MemoryCard[]>([]),
    [today, setToday] = useState<MemoryToday | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [view, setView] = useState<"today" | "library">("today"),
    [editor, setEditor] = useState<MemoryCard | "new" | null>(null),
    [initial, setInitial] = useState<MemoryCardWrite | undefined>();
  const [subject, setSubject] = useState(""),
    [search, setSearch] = useState(""),
    [browsing, setBrowsing] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    inFlight = useRef(false),
    pendingReview = useRef<MemoryReview | null>(null),
    generation = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    const [a, b] = await Promise.all([api.cards(), api.today()]);
    if (alive.current && seq === generation.current) {
      setCards(a.items);
      setToday(b);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current) {
        setError(studyError(e));
        setLoading(false);
      }
    });
    return () => {
      alive.current = false;
      ++generation.current;
    };
  }, [refresh]);
  useEffect(() => {
    if (!fromNote) return;
    const c = new AbortController();
    void getNotebookEntry(fromNote, c.signal)
      .then(({ entry }) => {
        if (!c.signal.aborted) {
          if (!entry) throw new Error("没有找到这条笔记。");
          setInitial({
            front: entry.title,
            back: entry.content,
            subject: entry.subject,
            source_note_id: entry.id,
            version: 0,
          });
          setEditor("new");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(studyError(e));
      });
    return () => c.abort();
  }, [fromNote]);
  // Poll only while this day's queue is waiting, and stop when another operation starts.
  useEffect(() => {
    if (!today?.next_due_at || today.ready.length) return;
    const timer = setInterval(() => {
      if (!inFlight.current) void refresh().catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [today?.next_due_at, today?.ready.length, refresh]);
  useEffect(() => {
    const onFocus = () => {
      if (!inFlight.current) void refresh().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  async function action(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      if (
        e instanceof ApiError &&
        ["STUDY_VERSION_CONFLICT", "MEMORY_DAY_CHANGED"].includes(e.code)
      ) {
        pendingReview.current = null;
        try {
          await refresh();
        } catch {
          /* Keep the original error and explicit retry. */
        }
      }
      if (alive.current) setError(studyError(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function rate(rating: MemoryReview["rating"]) {
    const card = today?.ready[0];
    if (!card || !today) return;
    if (!pendingReview.current)
      pendingReview.current = {
        card_id: card.id,
        version: card.version,
        day: today.day,
        rating,
        request_id: crypto.randomUUID(),
      };
    await action(async () => {
      const result = await api.review(pendingReview.current!);
      pendingReview.current = null;
      setNotice(
        result.completed
          ? "这张卡片今天复习完成"
          : `稍后再看 · ${new Date(result.card.due_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
      );
    });
  }
  function closeEditor() {
    setEditor(null);
    setInitial(undefined);
    if (fromNote) setParams({});
  }
  const current = today?.ready[0],
    visible = cards.filter(
      (c) =>
        (!subject || c.subject === subject) &&
        [c.front, c.back].join(" ").includes(search),
    );
  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
                    <h1>每日记忆卡</h1>
        </div>
        <button
          className="study-primary"
          onClick={() => {
            setInitial(undefined);
            setEditor("new");
          }}
        >
          <Plus size={18} />
          新建卡片
        </button>
      </header>
      <StudyToolsNav />
      <div className="study-memory-tabs" role="group" aria-label="记忆卡视图">
        <button
          aria-pressed={view === "today"}
          onClick={() => setView("today")}
        >
          今日复习
        </button>
        <button
          aria-pressed={view === "library"}
          onClick={() => setView("library")}
        >
          我的卡片 <span>{cards.length}</span>
        </button>
      </div>
      {error ? (
        <div className="study-error" role="alert">
          {error}
          {pendingReview.current ? (
            <button
              disabled={busy}
              onClick={() => void rate(pendingReview.current!.rating)}
            >
              重试这次自评
            </button>
          ) : (
            <button onClick={() => void action(async () => {})}>
              重新读取
            </button>
          )}
        </div>
      ) : null}
      {notice ? (
        <p className="study-save-notice" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <div className="study-card study-empty" role="status">
          正在整理卡片…
        </div>
      ) : view === "today" ? (
        <div className="study-memory-layout">
          <main>
            {current && today?.started ? (
              <MemoryReviewCard
                key={`${current.id}:${current.version}`}
                card={current}
                busy={busy || Boolean(pendingReview.current && error)}
                onRate={(r) => void rate(r)}
              />
            ) : (
              <section className="study-card study-daily-welcome">
                <div className="study-deck-illustration" aria-hidden="true">
                  <i />
                  <i />
                  <div>
                    <Layers3 size={46} />
                    <span>每日一练</span>
                  </div>
                </div>
                <h2>
                  {!cards.length
                    ? "先做一张属于你的记忆卡"
                    : today?.started &&
                        today.total > 0 &&
                        today.completed === today.total
                      ? "今天的卡片，复习好了"
                      : today?.next_due_at
                        ? "休息一下，稍后再回忆"
                        : today?.due_count
                          ? "用几分钟，唤醒学过的知识"
                          : "暂时没有到期卡片"}
                </h2>
                <p>
                  {!cards.length
                    ? "从课程考点选取，或把笔记里的关键内容做成卡片。"
                    : today?.next_due_at
                      ? `下一张将在 ${new Date(today.next_due_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 出现。`
                      : today?.started
                        ? "新的到期卡片将在下一天开始时加入任务。"
                        : `本次最多安排 ${Math.min(today?.due_count ?? 0, 20)} 张卡片。`}
                </p>
                {!cards.length ? (
                  <button
                    className="study-primary"
                    onClick={() => setEditor("new")}
                  >
                    <Plus size={18} />
                    创建第一张
                  </button>
                ) : (!today?.started || today.total === 0) &&
                  Boolean(today?.due_count) ? (
                  <button
                    className="study-primary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        setToday(await api.startDay());
                      })
                    }
                  >
                    <BookOpen size={18} />
                    开始今日复习
                  </button>
                ) : (
                  <button
                    onClick={() => setView("library")}
                    className="study-secondary"
                  >
                    浏览我的卡片
                  </button>
                )}
              </section>
            )}
          </main>
          <aside>
            <section className="study-card study-day-progress">
              <span className="study-eyebrow">{today?.day} · 今日任务</span>
              <div
                className="study-progress-ring"
                style={
                  {
                    "--progress": `${today?.total ? (360 * today.completed) / today.total : 0}deg`,
                  } as React.CSSProperties
                }
              >
                <strong>
                  {today?.completed ?? 0}
                  <small> / {today?.total ?? 0}</small>
                </strong>
              </div>
              <h2>已完成卡片</h2>
              <div>
                <span>
                  <Clock3 size={17} />
                  待继续
                </span>
                <b>
                  {Math.max(0, (today?.total ?? 0) - (today?.completed ?? 0))}
                </b>
              </div>
              <div>
                <span>
                  <Layers3 size={17} />
                  我的卡片
                </span>
                <b>{cards.length}</b>
              </div>
            </section>
            <section className="study-card study-memory-tip">
              <CheckCheck size={23} />
              <h3>先想一想，再翻面</h3>
              <p>按真实回忆情况选择，下一次复习时间会随之调整。</p>
            </section>
          </aside>
        </div>
      ) : (
        <section className="study-card study-card-library">
          <div className="study-filter-bar">
            <label>
              学科
              <select
                aria-label="筛选卡片学科"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">全部学科</option>
                {["通用", "数据结构", "组成原理", "操作系统", "计算机网络"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              搜索
              <input
                aria-label="搜索记忆卡"
                placeholder="搜索正面或答案"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="study-memory-library-grid">
            {visible.map((c) => (
              <article key={c.id} className="study-mini-card">
                <span className="study-question-meta">
                  {c.subject} ·{" "}
                  {c.reviews ? `复习 ${c.reviews} 次` : "尚未复习"}
                </span>
                <CardContent text={c.front} />
                {browsing === c.id ? (
                  <section className="study-browse-answer">
                    <CardContent text={c.back} />
                  </section>
                ) : null}
                <footer>
                  <button
                    aria-expanded={browsing === c.id}
                    onClick={() =>
                      setBrowsing((v) => (v === c.id ? null : c.id))
                    }
                  >
                    <Eye size={16} />
                    {browsing === c.id ? "收起答案" : "查看答案"}
                  </button>
                  <div>
                    <button
                      aria-label={`编辑卡片：${c.front}`}
                      onClick={() => setEditor(c)}
                      disabled={busy}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      aria-label={`删除卡片：${c.front}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("删除这张卡片及它的复习安排？"))
                          void action(async () => {
                            await api.removeCard(c.id, c.version);
                          });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </footer>
                <time>
                  下次复习{" "}
                  {new Date(c.due_at).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </article>
            ))}
          </div>
          {!visible.length ? (
            <div className="study-empty">
              <Layers3 size={35} />
              <h2>还没有符合条件的卡片</h2>
              <Link to="/student/notebook">从复习笔记开始</Link>
            </div>
          ) : null}
        </section>
      )}
      {editor ? (
        <MemoryCardEditor
          {...(editor !== "new" ? { card: editor } : {})}
          {...(initial ? { initial } : {})}
          onClose={closeEditor}
          onSaved={() => {
            closeEditor();
            void action(async () => {
              setNotice("卡片已保存");
            });
          }}
        />
      ) : null}
    </div>
  );
}
export function MemoryCardsPage() {
  const { account } = useAuth();
  return account ? <MemoryWorkspace key={account.user_id} /> : null;
}
