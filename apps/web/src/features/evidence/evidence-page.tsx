import type { LearningConceptProgress, LearningRecord } from "@xuetu/contracts";
import { ArrowRight, BookOpen, CheckCircle2, CircleAlert, History, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, getLearningRecord } from "../../api/client";
import { resolvePracticeRoute } from "../course/course-reading";

type ConceptStatus = LearningConceptProgress["status"];
type StatusFilter = "all" | ConceptStatus;

const STATUS_LABELS: Record<ConceptStatus, string> = {
  not_started: "未开始",
  reading: "阅读中",
  practiced: "已练习",
  needs_review: "待复习",
  mastered: "已掌握",
};

const COURSE_ROUTES: Record<string, string> = {
  course_408_ds: "/student/courses/data-structures",
  course_408_co: "/student/courses/computer-organization",
  course_408_os: "/student/courses/operating-systems",
  course_408_cn: "/student/courses/computer-networks",
};

const COURSE_SUBJECTS: Record<string, string> = {
  course_408_ds: "数据结构",
  course_408_co: "组成原理",
  course_408_os: "操作系统",
  course_408_cn: "计算机网络",
};

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "学习记录暂时无法读取，请稍后重试。";
}

function practiceEntry(courseId: string, courseTitle: string, concept: LearningConceptProgress) {
  const params = new URLSearchParams({
    subject: COURSE_SUBJECTS[courseId] ?? "数据结构",
  });
  const route = resolvePracticeRoute(`/student/practice?${params.toString()}`, concept);
  return {
    href: route.href,
    label: route.mode === "concept" ? "练习该知识点" : `进入${courseTitle}综合训练`,
  };
}

export function EvidencePage() {
  const [record, setRecord] = useState<LearningRecord | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setRecord(null);
    setError(null);
    getLearningRecord()
      .then((result) => {
        if (!active) return;
        setRecord(result);
        setSelectedCourseId((current) => (
          current && result.courses.some((course) => course.course_id === current)
            ? current
            : result.courses[0]?.course_id ?? null
        ));
      })
      .catch((caught: unknown) => { if (active) setError(readableError(caught)); });
    return () => { active = false; };
  }, [reloadKey]);

  const selectedCourse = useMemo(
    () => record?.courses.find((course) => course.course_id === selectedCourseId) ?? null,
    [record, selectedCourseId],
  );
  const visibleConcepts = useMemo(
    () => (selectedCourse?.concepts ?? []).filter((concept) => statusFilter === "all" || concept.status === statusFilter),
    [selectedCourse, statusFilter],
  );
  const totals = useMemo(() => (record?.courses ?? []).reduce((summary, course) => ({
    concepts: summary.concepts + course.concept_count,
    started: summary.started + course.started_concept_count,
    attempts: summary.attempts + course.practice_attempt_count,
    review: summary.review + course.needs_review_count,
  }), { concepts: 0, started: 0, attempts: 0, review: 0 }), [record]);

  if (error) {
    return (
      <div className="page-inner page-surface learning-record-page page-error" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <strong>{error}</strong>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">重新读取</button>
      </div>
    );
  }
  if (!record) {
    return <div className="page-inner page-surface learning-record-page page-loading" role="status">正在整理学习记录…</div>;
  }

  return (
    <div className="page-inner page-surface learning-record-page">
      <header className="cs-page-header module-page-header">
        <div>
          <p className="cs-workspace-kicker">408 学习记录</p>
          <h1>学习记录</h1>
          <p>阅读、练习和待复习情况会集中显示在这里，方便你继续下一步。</p>
        </div>
        <Link className="secondary-button" to="/student/home">返回课程学习 <ArrowRight aria-hidden="true" size={14} /></Link>
      </header>

      <section className="module-stat-strip learning-record-stats" aria-label="学习统计">
        <div className="featured"><span><History aria-hidden="true" size={15} /> 已开始知识点</span><strong>{totals.started}</strong><small>共 {totals.concepts} 个课程化知识点</small></div>
        <div><span>选择题作答</span><strong>{totals.attempts}</strong><small>记录你的课程练习</small></div>
        <div><span>待复习知识点</span><strong>{totals.review}</strong><small>按当前错题状态统计</small></div>
      </section>

      {record.courses.length === 0 ? (
        <section className="empty-state">
          <h2>暂时没有可展示的课程记录</h2>
          <p>课程知识地图接入后，阅读与练习记录会显示在这里。</p>
          <Link className="primary-button" to="/student/home">返回课程学习</Link>
        </section>
      ) : (
        <section className="learning-record-workspace" aria-label="课程学习进度">
          <nav className="learning-record-courses" aria-label="选择课程">
            {record.courses.map((course) => (
              <button
                aria-pressed={selectedCourseId === course.course_id}
                className={selectedCourseId === course.course_id ? "active" : ""}
                key={course.course_id}
                onClick={() => { setSelectedCourseId(course.course_id); setStatusFilter("all"); }}
                type="button"
              >
                <strong>{course.title}课程</strong>
                <span>{course.started_concept_count}/{course.concept_count} 已开始 · {course.needs_review_count} 待复习</span>
              </button>
            ))}
          </nav>

          {selectedCourse ? (
            <div className="learning-record-detail">
              <header>
                 <div><span>课程进度</span><h2>{selectedCourse.title}</h2><p>{selectedCourse.practice_attempt_count} 次作答 · {selectedCourse.correct_count} 次正确 · {selectedCourse.incorrect_count} 次错误</p></div>
                <Link to={COURSE_ROUTES[selectedCourse.course_id] ?? "/student/home"}>继续课程阅读 <BookOpen aria-hidden="true" size={15} /></Link>
              </header>
              <div className="learning-record-filter" aria-label="知识点状态筛选">
                {(["all", "reading", "practiced", "needs_review", "mastered", "not_started"] as const).map((status) => (
                  <button aria-pressed={statusFilter === status} className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)} type="button">
                    {status === "all" ? "全部" : `${STATUS_LABELS[status]}项`}
                  </button>
                ))}
              </div>

              {visibleConcepts.length === 0 ? (
                <div className="learning-record-empty"><CheckCircle2 aria-hidden="true" size={20} /><strong>当前状态下没有知识点</strong><span>切换状态查看其他学习记录。</span></div>
              ) : (
                <ol className="learning-concept-list">
                  {visibleConcepts.map((concept) => {
                    const practice = practiceEntry(selectedCourse.course_id, selectedCourse.title, concept);
                    return (
                    <li data-status={concept.status} key={concept.concept_id}>
                      <span className="learning-concept-state">{STATUS_LABELS[concept.status]}</span>
                      <div><strong>{concept.title}</strong><small>{concept.attempt_count > 0 ? `${concept.attempt_count} 次作答 · ${concept.correct_count} 对 / ${concept.incorrect_count} 错` : concept.status === "reading" ? "已保存阅读位置" : "尚无练习记录"}</small></div>
                      {concept.status === "needs_review" ? (
                        <Link to="/student/mistakes"><RotateCcw aria-hidden="true" size={14} />进入错题复习</Link>
                      ) : (
                        <Link to={practice.href}><ArrowRight aria-hidden="true" size={14} />{practice.label}</Link>
                      )}
                    </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
