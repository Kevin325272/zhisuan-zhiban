import type {
  MistakeRecommendationResponse,
  PracticeMistakeRecord,
  PracticeMistakeStatus,
} from "@xuetu/contracts";
import { BookOpenCheck, CheckCircle2, CircleAlert, Filter, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { StudyToolsNav } from "../study-library/study-tools";

import {
  ApiError,
  getPracticeMistakes,
  getStudentMistakeRecommendations,
  reopenPracticeMistake,
} from "../../api/client";

type StatusFilter = "all" | PracticeMistakeStatus;

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "错题记录暂时无法加载，请稍后重试。";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleDateString("zh-CN");
}

function practiceHref(record: PracticeMistakeRecord) {
  const params = new URLSearchParams({ mode: "mistake_review", subject: record.subject });
  if (record.concept_id) params.set("concept_id", record.concept_id);
  params.set("question_id", record.question_id);
  return `/student/practice?${params.toString()}`;
}

export function MistakesPage() {
  const [records, setRecords] = useState<PracticeMistakeRecord[] | null>(null);
  const [recommendations, setRecommendations] = useState<MistakeRecommendationResponse | null>(null);
  const [recommendationError, setRecommendationError] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const statusFilter: StatusFilter = statusParam === "needs_review" || statusParam === "mastered" ? statusParam : "all";
  const [courseFilter, setCourseFilter] = useState("all");
  const [conceptFilter, setConceptFilter] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestSequence = useRef(0);

  const loadRecords = useCallback(() => {
    const sequence = ++requestSequence.current;
    setError(null);
    setRecords(null);
    setRecommendations(null);
    setRecommendationError(false);
    getPracticeMistakes()
      .then((result) => { if (sequence === requestSequence.current) setRecords(result.items); })
      .catch((caught: unknown) => { if (sequence === requestSequence.current) setError(readableError(caught)); });
    getStudentMistakeRecommendations({ limit: 3 })
      .then((result) => { if (sequence === requestSequence.current) setRecommendations(result); })
      .catch(() => { if (sequence === requestSequence.current) setRecommendationError(true); });
  }, []);

  useEffect(() => {
    loadRecords();
    return () => { ++requestSequence.current; };
  }, [loadRecords, reloadKey]);

  const courseOptions = useMemo(
    () => [...new Map((records ?? []).map((record) => [record.course_id, record.course_title])).entries()],
    [records],
  );
  const visibleRecords = useMemo(() => {
    const query = conceptFilter.trim().toLocaleLowerCase();
    return (records ?? []).filter((record) => (
      (statusFilter === "all" || record.status === statusFilter)
      && (courseFilter === "all" || record.course_id === courseFilter)
      && (!query || (record.concept_title ?? "").toLocaleLowerCase().includes(query))
    ));
  }, [conceptFilter, courseFilter, records, statusFilter]);
  const pendingCount = (records ?? []).filter((record) => record.status === "needs_review").length;
  const priorityRecommendation = recommendations?.items[0] ?? null;

  function updateStatusFilter(value: StatusFilter) {
    const nextParams = new URLSearchParams(searchParams);
    if (value === "all") nextParams.delete("status");
    else nextParams.set("status", value);
    setSearchParams(nextParams, { replace: true });
  }

  async function reopenMistake(record: PracticeMistakeRecord) {
    if (updatingId) return;
    setUpdatingId(record.mistake_id);
    setError(null);
    try {
      await reopenPracticeMistake(record.mistake_id);
      loadRecords();
    } catch (caught: unknown) {
      setError(readableError(caught));
    } finally {
      setUpdatingId(null);
    }
  }

  if (error && !records) {
    return (
      <div className="page-inner page-surface mistakes-page page-error" data-visual-system="ochre-serif" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <strong>{error}</strong>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">重新读取</button>
      </div>
    );
  }
  if (!records) {
    return <div className="page-inner page-surface mistakes-page page-loading" data-visual-system="ochre-serif" role="status">正在读取错题记录…</div>;
  }

  return (
    <div className="page-inner page-surface mistakes-page" data-visual-system="ochre-serif">
      <StudyToolsNav />
      <header className="page-heading compact-page-heading">
        <div>
          <Link className="course-back-link" to="/student/home">课程首页</Link>
          <h1>错题本</h1>
        </div>
        <span className="student-context">{records.length} 条记录</span>
      </header>

      {priorityRecommendation ? (
        <section className="mistake-priority-callout" aria-label="建议先练">
          <div>
            <span>建议先练</span>
            <h2>{priorityRecommendation.course_title} · {priorityRecommendation.concept_title}</h2>
            <p>{priorityRecommendation.reason_lines.slice(0, 2).join(" · ")}</p>
          </div>
          <Link to={priorityRecommendation.practice_href}>复习第 {priorityRecommendation.question_number} 题<RotateCcw aria-hidden="true" size={15} /></Link>
        </section>
      ) : recommendationError ? (
        <p className="mistake-priority-unavailable" role="status">优先排序暂时不可用，仍可按错题列表继续复习。</p>
      ) : null}

      <div className="mistake-toolbar" aria-label="错题筛选">
        <div>
          <span className="soft-icon coral"><RotateCcw aria-hidden="true" size={15} /></span>
          <span><small>待复习</small><strong>{pendingCount} 项</strong></span>
        </div>
        <label className="mistake-course-filter">课程
          <select aria-label="错题课程" onChange={(event) => setCourseFilter(event.target.value)} value={courseFilter}>
            <option value="all">全部课程</option>
            {courseOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
        <label className="mistake-concept-filter">知识点
          <input aria-label="错题知识点" onChange={(event) => setConceptFilter(event.target.value)} placeholder="搜索知识点" value={conceptFilter} />
        </label>
        <div className="segmented-filter" aria-label="错题状态">
          <Filter aria-hidden="true" size={13} />
          {(["all", "needs_review", "mastered"] as const).map((value) => (
              <button key={value} type="button" className={statusFilter === value ? "active" : ""} aria-pressed={statusFilter === value} onClick={() => updateStatusFilter(value)}>
              {value === "all" ? "全部" : value === "needs_review" ? "待复习" : "已掌握"}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="practice-inline-error" role="alert">{error}</p> : null}
      {visibleRecords.length === 0 ? (
        <section className="empty-state">
          <span className="soft-icon sage"><CheckCircle2 aria-hidden="true" size={20} /></span>
          <h2>{records.length === 0 ? "还没有错题记录" : "当前筛选下没有记录"}</h2>
          <p>{records.length === 0 ? "练习中的错题会自动收录，方便你集中复习。" : "调整课程、知识点或状态筛选后再查看。"}</p>
          <Link className="primary-button" to="/student/home">返回课程学习</Link>
        </section>
      ) : (
        <div className="mistake-collection">
          <p className="mistake-review-rule"><CheckCircle2 size={16} />连续正确重练 3 次后，题目会自动标记为已掌握。</p>
          <div className="mistake-card-grid">
          {visibleRecords.map((record) => (
            <article className="mistake-item mistake-compact" key={record.mistake_id}>
              <header>
                <div>
                  <span className={`mistake-state ${record.status}`}>
                    {record.status === "mastered" ? "已掌握" : "待复习"}
                  </span>
                  <span>
                    <h2>{record.concept_title ?? `${record.subject}课程题目`}</h2>
                    <small>{record.course_title}</small>
                  </span>
                </div>
              </header>
              <div className="mistake-record-line">
                <span><BookOpenCheck size={15} />选择题 · 第 {record.question_number} 题</span>
                <span>答错 <b>{record.wrong_count}</b> 次</span>
              </div>
              <p className="mistake-last-date">最近答错 · {formatDate(record.last_incorrect_at)}</p>
              <footer>
                {record.status === "mastered" ? (
                  <button disabled={updatingId === record.mistake_id} onClick={() => reopenMistake(record)} type="button">{updatingId === record.mistake_id ? "处理中…" : "重新加入复习"}</button>
                ) : record.latest_attempt_outcome === "correct" ? <span className="mistake-latest-outcome">最近重练已答对</span> : null}
                <Link to={practiceHref(record)}><RotateCcw aria-hidden="true" size={15} />重练这道题</Link>
              </footer>
            </article>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
