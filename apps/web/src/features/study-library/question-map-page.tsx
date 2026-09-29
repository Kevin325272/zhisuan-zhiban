import {
  ArrowRight,
  Check,
  Map as MapIcon,
  RotateCcw,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  studyMapQuerySchema,
  type StudyMap,
  type StudyQuestion,
} from "@xuetu/contracts";
import { useAuth } from "../auth/auth-context";
import { StudyToolsNav, studyError, studyQueueHref } from "./study-tools";
import { studyLibraryApi as api } from "./study-library-api";
import { rememberStudyQueue } from "./study-queue-storage";

const subjects = ["数据结构", "组成原理", "操作系统", "计算机网络"];
const statusNames = {
  unseen: "未作答",
  correct: "最近答对",
  incorrect: "最近答错",
  pending_review: "待评阅",
};
export function QuestionMapPage() {
  const { account } = useAuth();
  return account ? <QuestionMapWorkspace key={account.user_id} /> : null;
}
function QuestionMapWorkspace() {
  const { account } = useAuth();
  const [params, setParams] = useSearchParams(),
    [data, setData] = useState<StudyMap | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [topicSearch, setTopicSearch] = useState(""),
    [topics, setTopics] = useState<StudyMap["topics"]>([]);
  const parsed = studyMapQuerySchema.safeParse(Object.fromEntries(params)),
    query = parsed.success ? parsed.data : studyMapQuerySchema.parse({});
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    void api
      .map(query, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setData(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(studyError(e));
      });
    return () => c.abort();
  }, [queryKey, revision]);
  useEffect(() => {
    const c = new AbortController();
    void api
      .map({ source: query.source, subject: query.subject }, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setTopics(v.topics);
      })
      .catch(() => {
        if (!c.signal.aborted) setTopics([]);
      });
    return () => c.abort();
  }, [query.source, query.subject, revision]);
  function filter(key: string, value: string) {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    if (key === "subject" || key === "source") {
      p.delete("topic");
      p.delete("year");
    }
    setParams(p);
  }
  const groups = new Map<string, StudyQuestion[]>();
  for (const q of data?.items ?? []) {
    const label =
      q.source === "past_exam" ? `${q.year} 年` : `${q.subject} · 专项练习`;
    const list = groups.get(label) ?? [];
    list.push(q);
    groups.set(label, list);
  }
  const queue = (q: StudyQuestion) => studyQueueHref(q, "map", queryKey);
  const remember = (event: React.MouseEvent) => {
    try {
      if (account && data)
        rememberStudyQueue(account.user_id, queryKey, data.items);
    } catch {
      event.preventDefault();
      setError("浏览器暂时无法保留练习队列，请重新打开页面再试。");
    }
  };
  return (
    <div className="study-page">
      <header className="study-heading">
        <div>
          <span className="study-eyebrow">408 · 练习导航</span>
          <h1>题目地图</h1>
        </div>
        <Link to="/student/practice" className="study-quiet-link">
          回到题库
          <ArrowRight size={17} />
        </Link>
      </header>
      <StudyToolsNav />
      <div className="study-map-layout">
        <aside className="study-card study-map-filters">
          <h2>考点与关键词</h2>
          <label className="study-search">
            <Search size={17} />
            <input
              aria-label="搜索考点"
              placeholder="搜索考点"
              value={topicSearch}
              onChange={(e) => setTopicSearch(e.target.value)}
            />
          </label>
          <button
            className={!query.topic ? "selected" : ""}
            onClick={() => filter("topic", "")}
          >
            全部考点
          </button>
          <div className="study-topic-list">
            {topics
              .filter((t) =>
                t.title.toLowerCase().includes(topicSearch.toLowerCase()),
              )
              .map((t) => (
                <button
                  key={t.id}
                  className={query.topic === t.id ? "selected" : ""}
                  onClick={() => filter("topic", t.id)}
                >
                  <span>
                    {t.title}
                    {t.kind === "keyword" ? (
                      <small className="study-keyword-label">关键词</small>
                    ) : null}
                  </span>
                  <b>{t.count}</b>
                </button>
              ))}
          </div>
        </aside>
        <main className="study-map-main">
          <section className="study-map-summary">
            <div>
              <span>当前筛选</span>
              <strong>
                {data?.total ?? "—"}
                <small>题</small>
              </strong>
            </div>
            <div>
              <span>已作答</span>
              <strong>{data?.attempted ?? "—"}</strong>
            </div>
            <div>
              <span>最近答对</span>
              <strong>{data?.correct ?? "—"}</strong>
            </div>
            {data?.items[0] ? (
              <Link
                className="study-primary"
                to={queue(data.items[0])}
                onClick={remember}
              >
                练这一组
                <ArrowRight size={17} />
              </Link>
            ) : null}
          </section>
          <div className="study-filter-bar">
            <label>
              题目来源
              <select
                aria-label="题目来源"
                value={query.source}
                onChange={(e) => filter("source", e.target.value)}
              >
                <option value="all">全部题目</option>
                <option value="past_exam">历年真题</option>
                <option value="practice">专项练习</option>
              </select>
            </label>
            <label>
              学科
              <select
                aria-label="地图学科"
                value={query.subject}
                onChange={(e) => filter("subject", e.target.value)}
              >
                <option value="">全部学科</option>
                {subjects.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              年份
              <select
                aria-label="地图年份"
                value={query.year ?? ""}
                onChange={(e) => filter("year", e.target.value)}
              >
                <option value="">全部年份</option>
                {data?.years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label>
              作答状态
              <select
                aria-label="作答状态"
                value={query.status}
                onChange={(e) => filter("status", e.target.value)}
              >
                <option value="all">全部状态</option>
                {Object.entries(statusNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button aria-label="清除地图筛选" onClick={() => setParams({})}>
              <RotateCcw size={17} />
            </button>
          </div>
          {error ? (
            <div className="study-error" role="alert">
              {error}
              <button onClick={() => setRevision((r) => r + 1)}>
                重新读取
              </button>
            </div>
          ) : !data ? (
            <div role="status" className="study-empty">
              正在展开题目地图…
            </div>
          ) : !data.items.length ? (
            <div className="study-card study-empty">
              <MapIcon size={38} />
              <h2>这个筛选下还没有题目</h2>
              <button onClick={() => setParams({})}>查看全部可练题目</button>
            </div>
          ) : (
            <section
              className="study-card study-map-grid"
              aria-label="筛选题目地图"
            >
              <div className="study-map-legend">
                {Object.entries(statusNames).map(([s, n]) => (
                  <span key={s}>
                    <i className={s} />
                    {n}
                  </span>
                ))}
              </div>
              {[...groups].map(([label, questions]) => (
                <div className="study-map-year" key={label}>
                  <h3>
                    {label}
                    <span>{questions.length} 题</span>
                  </h3>
                  <div className="study-number-grid">
                    {questions.map((q) => (
                      <Link
                        key={q.id}
                        to={queue(q)}
                        onClick={remember}
                        className={`study-number ${q.status}`}
                        title={`${q.subject} · 第${q.number}题 · ${statusNames[q.status]}\n${q.topics.map((t) => t.title).join("、")}`}
                        aria-label={`${q.year ?? "专项"} ${q.subject} 第${q.number}题，${statusNames[q.status]}`}
                      >
                        {q.status === "correct" ? <Check size={11} /> : null}
                        {String(q.number).padStart(2, "0")}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
          {data && data.topics.length ? (
            <section className="study-card study-frequency">
              <header>
                <h2>当前题目分布</h2>
                <span>题目数 / 涉及真题年份数</span>
              </header>
              {data.topics.slice(0, 12).map((t) => (
                <button key={t.id} onClick={() => filter("topic", t.id)}>
                  <span>
                    {t.title}
                    {t.kind === "keyword" ? (
                      <small className="study-keyword-label">题干提及</small>
                    ) : null}
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${(100 * t.count) / Math.max(1, data.topics[0]!.count)}%`,
                      }}
                    />
                  </div>
                  <b>
                    {t.count} 题 · {t.years} 年
                  </b>
                </button>
              ))}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
