import { ArrowRight, BookOpen, Network, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCourseCurriculumMap, type CourseCurriculumMapData } from "../../api/client";
import "./course-map-page.css";

const subjects = [
  { slug: "data-structures", label: "数据结构" },
  { slug: "computer-organization", label: "计算机组成原理" },
  { slug: "operating-systems", label: "操作系统" },
  { slug: "computer-networks", label: "计算机网络" },
] as const;

type Chapter = CourseCurriculumMapData["chapters"][number];

function locationsFor(map: CourseCurriculumMapData) {
  return map.chapters.flatMap((chapter) => chapter.modules.flatMap((module) =>
    module.concepts.map((concept) => ({ chapter, module, concept })),
  ));
}

export function CourseMapPage() {
  const [params, setParams] = useSearchParams();
  const subject = subjects.find((item) => item.slug === params.get("subject")) ?? subjects[0];
  const [maps, setMaps] = useState<Partial<Record<string, CourseCurriculumMapData>>>({});
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const map = maps[subject.slug];
  const chapter = map?.chapters.find((item) => item.chapter_id === params.get("chapter")) ?? map?.chapters[0];
  const locations = map ? locationsFor(map) : [];
  const locationById = new Map(locations.map((location) => [location.concept.concept_id, location]));
  const visible = chapter?.modules.flatMap((module) => module.concepts) ?? [];
  const selected = visible.find((concept) => concept.concept_id === params.get("concept")) ?? visible[0];
  const prerequisites = selected?.prerequisite_concept_ids
    .map((id) => locationById.get(id))
    .filter((location) => location !== undefined) ?? [];

  useEffect(() => {
    if (map) return;
    let active = true;
    setError(false);
    getCourseCurriculumMap(subject.slug)
      .then((result) => { if (active) setMaps((current) => ({ ...current, [subject.slug]: result })); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [map, subject.slug, retry]);

  function navigate(next: { subject?: string; chapter?: string; concept?: string }) {
    const query = new URLSearchParams();
    query.set("subject", next.subject ?? subject.slug);
    if (next.chapter) query.set("chapter", next.chapter);
    if (next.concept) query.set("concept", next.concept);
    setParams(query);
  }

  const nodePositions = new Map(visible.map((concept, index) => [concept.concept_id, {
    x: [16, 50, 84][index % 3]!, y: 85 + Math.floor(index / 3) * 128,
  }]));
  const graphHeight = Math.max(310, 170 + Math.ceil(visible.length / 3) * 128);
  const edges = visible.flatMap((concept) => concept.prerequisite_concept_ids
    .filter((id) => nodePositions.has(id))
    .map((id) => ({ from: id, to: concept.concept_id })));

  return (
    <div className="page-inner page-surface course-map-page curriculum-graph-page">
      <header className="page-heading compact-page-heading">
        <div><h1>408 知识图谱</h1><p>按课程和章节查看知识概念及先修关系。</p></div>
        {map ? <span className="curriculum-graph-total">{map.concept_count} 个知识点</span> : null}
      </header>
      <nav aria-label="选择课程" className="curriculum-subjects">
        {subjects.map((item) => (
          <button aria-current={subject.slug === item.slug ? "page" : undefined}
            className={subject.slug === item.slug ? "active" : undefined}
            key={item.slug} onClick={() => navigate({ subject: item.slug })} type="button">{item.label}</button>
        ))}
      </nav>
      {error ? (
        <div className="curriculum-graph-state" role="alert">
          <p>知识图谱暂时无法读取，请稍后重试。</p>
          <button onClick={() => setRetry((value) => value + 1)} type="button"><RefreshCcw aria-hidden="true" size={16} />重新加载</button>
        </div>
      ) : !map || !chapter ? (
        <p className="curriculum-graph-state" role="status">正在加载知识图谱…</p>
      ) : (
        <div className="curriculum-graph-layout">
          <aside aria-label="课程章节" className="curriculum-chapters">
            <h2>课程章节</h2>
            {map.chapters.map((item) => (
              <button aria-current={item.chapter_id === chapter.chapter_id ? "true" : undefined}
                className={item.chapter_id === chapter.chapter_id ? "active" : undefined}
                key={item.chapter_id} onClick={() => navigate({ chapter: item.chapter_id })} type="button">
                <span>{String(item.ordinal).padStart(2, "0")}</span><strong>{item.title}</strong>
                <small>{item.modules.reduce((sum, module) => sum + module.concepts.length, 0)} 个知识点</small>
              </button>
            ))}
          </aside>
          <section aria-label="知识依赖图" className="curriculum-graph-main">
            <header className="curriculum-graph-heading">
              <div><span>{subject.label} / {chapter.source_chapter}</span><h2>{chapter.title}</h2></div>
              <small>{visible.length} 个知识点 · {edges.length} 条章内依赖</small>
            </header>
            <div className="curriculum-graph-scroll">
              <div aria-label={`${chapter.title}知识图谱`} className="curriculum-graph-canvas" style={{ height: graphHeight }}>
                <svg aria-hidden="true" className="curriculum-graph-lines" preserveAspectRatio="none" viewBox={`0 0 100 ${graphHeight}`}>
                  <defs><marker id="curriculum-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3"><path d="M0 0 L6 3 L0 6 Z" /></marker></defs>
                  {edges.map((edge) => {
                    const from = nodePositions.get(edge.from)!;
                    const to = nodePositions.get(edge.to)!;
                    return <line className={selected && (edge.from === selected.concept_id || edge.to === selected.concept_id) ? "active" : undefined}
                      key={`${edge.from}-${edge.to}`} markerEnd="url(#curriculum-arrow)"
                      x1={from.x} x2={to.x} y1={from.y} y2={to.y} />;
                  })}
                </svg>
                {visible.map((concept) => {
                  const position = nodePositions.get(concept.concept_id)!;
                  return (
                    <button aria-pressed={concept.concept_id === selected?.concept_id}
                      className={`curriculum-graph-node${concept.concept_id === selected?.concept_id ? " active" : ""}`}
                      key={concept.concept_id}
                      onClick={() => navigate({ chapter: chapter.chapter_id, concept: concept.concept_id })}
                      style={{ left: `${position.x}%`, top: position.y }} type="button">
                      <span>{chapter.modules.find((module) => module.concepts.includes(concept))?.title}</span>
                      <strong>{concept.title}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="curriculum-graph-caption">连线表示章内先修关系；跨章节先修项见右侧详情。图谱呈现课程知识结构，不代表个人掌握度。</p>
          </section>
          {selected ? (
            <aside aria-label="知识点详情" className="curriculum-graph-detail">
              <span className="curriculum-graph-detail-kicker"><Network aria-hidden="true" size={15} /> 知识点详情</span>
              <h2>{selected.title}</h2><p>{selected.learning_objective}</p>
              <h3>先修知识</h3>
              {prerequisites.length ? (
                <div className="curriculum-prerequisites">
                  {prerequisites.map((item) => (
                    <button key={item.concept.concept_id}
                      onClick={() => navigate({ chapter: item.chapter.chapter_id, concept: item.concept.concept_id })} type="button">
                      {item.concept.title}<ArrowRight aria-hidden="true" size={14} />
                    </button>
                  ))}
                </div>
              ) : <p>无先修要求</p>}
              <h3>核心术语</h3>
              <div className="curriculum-keywords">{selected.key_terms.map((term) => <span key={term}>{term}</span>)}</div>
              <Link className="curriculum-graph-read" to={`/student/courses/${subject.slug}?concept_id=${encodeURIComponent(selected.concept_id)}`}>
                <BookOpen aria-hidden="true" size={16} />学习这个知识点<ArrowRight aria-hidden="true" size={16} />
              </Link>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
