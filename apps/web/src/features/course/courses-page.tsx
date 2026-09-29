import {
  ArrowRight,
  Bot,
  Boxes,
  Cpu,
  BrainCircuit,
  FlaskConical,
  Layers3,
  Network,
  RefreshCcw,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { get408Courses, type CourseCatalogData } from "../../api/client";
import { OPEN_AGENT_EVENT } from "../agent/global-agent-fab";

const COURSE_ICONS: Record<string, LucideIcon> = {
  "data-structures": Boxes,
  "computer-organization": Cpu,
  "operating-systems": Layers3,
  "computer-networks": Network,
};

export function CoursesPage() {
  const [catalog, setCatalog] = useState<CourseCatalogData | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setCatalog(null);
    setError(false);

    get408Courses()
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <section className="courses-overview-state is-error" data-visual-system="ochre-serif" role="alert">
        <RefreshCcw aria-hidden="true" size={22} />
        <strong>课程总览暂时无法读取</strong>
        <span>请检查网络连接后重试。</span>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">
          重新加载课程
        </button>
      </section>
    );
  }

  if (!catalog) {
    return (
      <section className="courses-overview-state" data-visual-system="ochre-serif" role="status">
        <span className="courses-overview-loader" aria-hidden="true" />
        <strong>正在加载 408 课程</strong>
        <span>正在整理四门课的章节、知识点与练习…</span>
      </section>
    );
  }

  const courses = [...catalog.courses].sort((left, right) => left.display_order - right.display_order);
  const questionCount = courses.reduce((total, course) => total + course.question_count, 0);

  return (
    <section className="courses-overview-page" data-visual-system="ochre-serif">
      <header className="courses-overview-heading">
        <div>
          <h1>四科专家智能体中枢</h1>
          <p>四科各由一位专家 Agent 主理，从讲解、练习到 3D 仿真全链路护航。</p>
        </div>
        <dl aria-label="408 课程数据概况">
          <div>
            <dt>课程</dt>
            <dd>{courses.length}</dd>
          </div>
          <div>
            <dt>可评分选择题</dt>
            <dd>{questionCount}</dd>
          </div>
        </dl>
      </header>

      <section className="courses-intelligence-strip" aria-label="智能学习功能">
        <div className="courses-intelligence-heading">
          <span className="courses-overview-eyebrow">AI 学习引擎</span>
          <h2>从诊断到掌握，全程有学伴</h2>
          <p>结合学习记录推荐练习与知识路径，并提供课程答疑，让每一步更有针对性。</p>
        </div>
        <div className="courses-intelligence-actions">
          <Link to="/student/practice"><BrainCircuit aria-hidden="true" size={19} /><span><strong>智能出题</strong><small>按薄弱知识点选配练习</small></span><ArrowRight aria-hidden="true" size={15} /></Link>
          <Link to="/student/course-map"><Network aria-hidden="true" size={19} /><span><strong>知识图谱</strong><small>查看知识依赖与掌握度</small></span><ArrowRight aria-hidden="true" size={15} /></Link>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_AGENT_EVENT))}><Bot aria-hidden="true" size={19} /><span><strong>AI 学伴答疑</strong><small>课程内随时提问与追问</small></span><ArrowRight aria-hidden="true" size={15} /></button>
        </div>
      </section>

      <section className="courses-overview-domain" aria-label="408 课程域">
        <header>
          <div>
            <span className="courses-overview-eyebrow">课程与练习</span>
            <h2 id="courses-domain-title">四门课，一条学习主线</h2>
          </div>
        </header>

        <ol className="courses-overview-list">
          {courses.map((course, index) => {
            const Icon = COURSE_ICONS[course.slug] ?? Boxes;
            return (
              <li key={course.course_id}>
                <article>
                  <div className="courses-overview-index" aria-hidden="true">
                    <Icon size={21} />
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>

                  <div className="courses-overview-copy">
                    <span>{course.course_code}<span className="agent-drive-badge">[Agent 驱动]</span></span>
                    <h3>{course.title}</h3>
                    <p>{course.summary}</p>
                  </div>

                  <dl className="courses-overview-metrics" aria-label={`${course.title}课程数据`}>
                    <div><dt>章节</dt><dd>{course.chapter_count}</dd></div>
                    <div><dt>核心知识点</dt><dd>{course.core_concept_count}</dd></div>
                    <div><dt>选择题</dt><dd>{course.question_count}</dd></div>
                  </dl>

                  <div className="courses-overview-entry">
                    <span className={course.material_status === "available" ? "is-ready" : "is-pending"}>
                      {course.material_status === "available" ? "课程知识结构已接入" : "课程讲解资料待接入"}
                    </span>
                    <div className="courses-overview-actions">
                      {course.slug === "computer-networks" ? (
                        <>
                          <Link className="courses-overview-lab-action" to="/student/programming-experiments">
                            <FlaskConical aria-hidden="true" size={16} />进入 3D 仿真 <ArrowRight aria-hidden="true" size={16} />
                          </Link>
                          <Link to={`/student/courses/${course.slug}`}>
                            进入课程 <ArrowRight aria-hidden="true" size={16} />
                          </Link>
                        </>
                      ) : (
                        <Link to={`/student/courses/${course.slug}`}>
                          启动具身研学 <ArrowRight aria-hidden="true" size={16} />
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </section>
    </section>
  );
}
