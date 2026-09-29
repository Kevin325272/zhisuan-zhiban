import { CourseSourceDocument } from "./course-source-page";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  ApiError,
  get408Courses,
  getCourseCurriculumMap,
  getCourseKnowledge,
  getCourseReadingProgress,
  saveCourseReadingProgress,
  type CourseCatalogData,
  type CourseCurriculumMapData,
  type CourseKnowledgeData,
} from "../../api/client";
import {
  type PersistedCourseReadingPosition,
  useCourseReadingTaskSettlement,
} from "../learning/course-reading-task-settlement";
import { useStudentTaskProgress } from "../learning/student-task-progress";
import { buildReadingParagraphs, resolvePracticeRoute } from "./course-reading";
import { CourseVideoResources } from "./course-video-resources";
import { CourseReaderHeading } from "./course-reader-heading";
import { CourseReaderWorkspace } from "./course-reader-workspace";
import { useCourseReaderPosition } from "./use-course-reader-position";
import { CourseFigure } from "./course-figure";
import { CourseAiExplanation } from "../ai/course-ai-explanation";

const COURSE_SLUG = "computer-networks";
const TRAINING_HREF = "/student/practice?subject=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%BD%91%E7%BB%9C";
const SOURCE_PREVIEW_PARAGRAPHS = 2;

type CurriculumChapter = CourseCurriculumMapData["chapters"][number];
type CurriculumModule = CurriculumChapter["modules"][number];
type CurriculumConcept = CurriculumModule["concepts"][number];

interface ConceptLocation {
  chapter: CurriculumChapter;
  module: CurriculumModule;
  concept: CurriculumConcept;
}

function flattenConcepts(curriculum: CourseCurriculumMapData): ConceptLocation[] {
  return curriculum.chapters.flatMap((chapter) =>
    chapter.modules.flatMap((module) =>
      module.concepts.map((concept) => ({ chapter, module, concept })),
    ),
  );
}

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "计算机网络课程暂时无法读取，请稍后重试。";
}

function studentImageUrl(path: string) {
  return path;
}

export function ComputerNetworksPage() {
  const [searchParams] = useSearchParams();
  const requestedConceptId = searchParams.get("concept_id")?.trim() || null;
  const orchestrationTaskId = searchParams.get("orchestration_task_id")?.trim() || null;
  const taskProgress = useStudentTaskProgress(orchestrationTaskId);
  const [catalog, setCatalog] = useState<CourseCatalogData | null>(null);
  const [curriculum, setCurriculum] = useState<CourseCurriculumMapData | null>(null);
  const [knowledge, setKnowledge] = useState<CourseKnowledgeData | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [chunkOffset, setChunkOffset] = useState(0);
  const [sourcePageNavigation, setSourcePageNavigation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [chapterMapCollapsed, setChapterMapCollapsed] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(() => new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => new Set());
  const [visitedConceptIds, setVisitedConceptIds] = useState<Set<string>>(() => new Set());
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [progressStatus, setProgressStatus] = useState<"loading" | "ready" | "load_error" | "save_error">("loading");
  const [resumeApplied, setResumeApplied] = useState(false);
  const [persistedReadingPosition, setPersistedReadingPosition] = useState<PersistedCourseReadingPosition | null>(null);
  const pendingResumeRef = useRef<Awaited<ReturnType<typeof getCourseReadingProgress>>["progress"]>(null);
  const progressSnapshotRef = useRef<Parameters<typeof saveCourseReadingProgress>[1] | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressWriteVersionRef = useRef(0);
  const readingBodyRef = useRef<HTMLDivElement | null>(null);

  const conceptLocations = useMemo(
    () => curriculum ? flattenConcepts(curriculum) : [],
    [curriculum],
  );
  const currentLocation = useMemo(
    () => conceptLocations.find((location) => location.concept.concept_id === selectedConceptId) ?? null,
    [conceptLocations, selectedConceptId],
  );
  const currentConcept = currentLocation?.concept ?? null;
  const trainingRoute = currentConcept
    ? resolvePracticeRoute(TRAINING_HREF, currentConcept)
    : { href: TRAINING_HREF, mode: "course" as const, questionCount: 0 };
  const trainingHref = trainingRoute.href;
  const currentChunk = knowledge?.items[0] ?? null;
  const hasOriginal = Boolean(currentChunk?.source_page);
  const readingParagraphs = useMemo(
    () => currentChunk ? buildReadingParagraphs(currentChunk.text) : [],
    [currentChunk],
  );
  const visibleParagraphs = sourceExpanded || hasOriginal
    ? readingParagraphs
    : readingParagraphs.slice(0, SOURCE_PREVIEW_PARAGRAPHS);
  const hiddenParagraphCount = Math.max(0, readingParagraphs.length - SOURCE_PREVIEW_PARAGRAPHS);

  useCourseReadingTaskSettlement({
    taskId: orchestrationTaskId,
    taskStatus: taskProgress.status,
    completeTask: taskProgress.complete,
    currentChunkId: currentChunk?.chunk_id ?? null,
    persistedPosition: persistedReadingPosition,
  });

  useEffect(() => {
    let active = true;
    setCatalog(null);
    setCurriculum(null);
    setKnowledge(null);
    setSelectedConceptId(null);
    setError(null);
    setExpandedChapters(new Set());
    setExpandedModules(new Set());
    setVisitedConceptIds(new Set());
    setProgressStatus("loading");
    progressWriteVersionRef.current += 1;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setResumeApplied(false);
    setPersistedReadingPosition(null);
    pendingResumeRef.current = null;
    const progressRequest = getCourseReadingProgress(COURSE_SLUG)
      .then((result) => ({ ok: true as const, result }))
      .catch(() => ({ ok: false as const }));

    Promise.all([get408Courses(), getCourseCurriculumMap(COURSE_SLUG), progressRequest])
      .then(([nextCatalog, nextCurriculum, progressResult]) => {
        if (!active) return;
        const locations = flattenConcepts(nextCurriculum);
        const saved = progressResult.ok ? progressResult.result.progress : null;
        const requestedLocation = requestedConceptId
          ? locations.find((location) => location.concept.concept_id === requestedConceptId) ?? null
          : null;
        const savedLocation = !requestedLocation && saved
          ? locations.find((location) => location.concept.sources.some((source) => source.chunk_id === saved.chunk_id)) ?? null
          : null;
        const start = requestedLocation ?? savedLocation ?? locations[0] ?? null;
        if (!start) {
          setError("课程知识地图没有可学习的核心知识点。");
          return;
        }
        setCatalog(nextCatalog);
        setCurriculum(nextCurriculum);
        setSelectedConceptId(start.concept.concept_id);
        setExpandedChapters(new Set([start.chapter.chapter_id]));
        setExpandedModules(new Set([start.module.module_id]));
        if (saved && savedLocation && !requestedLocation) {
          pendingResumeRef.current = saved;
          setChunkOffset(saved.chunk_offset);
          setProgressStatus("ready");
        } else {
          setChunkOffset(start.concept.sources[0]?.chunk_offset ?? 0);
          setProgressStatus(progressResult.ok ? "ready" : "load_error");
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught));
      });
    return () => { active = false; };
  }, [reloadKey, requestedConceptId]);

  useEffect(() => {
    if (!currentLocation) return undefined;
    let active = true;
    setKnowledgeLoading(true);
    setKnowledge(null);
    setSourceExpanded(false);
    setParagraphIndex(0);
    setResumeApplied(false);
    setPersistedReadingPosition(null);
    getCourseKnowledge(COURSE_SLUG, {
      chapter: currentLocation.chapter.source_chapter,
      limit: 1,
      offset: chunkOffset,
    })
      .then((result) => {
        if (!active) return;
        const saved = pendingResumeRef.current;
        const chunk = result.items[0] ?? null;
        if (saved && chunk?.chunk_id === saved.chunk_id) {
          const count = buildReadingParagraphs(chunk.text).length;
          const restored = Math.min(saved.paragraph_index, Math.max(0, count - 1));
          setSourceExpanded(saved.source_expanded || restored >= SOURCE_PREVIEW_PARAGRAPHS);
          setParagraphIndex(restored);
          setPersistedReadingPosition({
            chunkId: saved.chunk_id,
            paragraphIndex: restored,
            sourceExpanded: saved.source_expanded,
          });
          setResumeApplied(true);
          pendingResumeRef.current = null;
        }
        setKnowledge(result);
      })
      .catch((caught: unknown) => { if (active) setError(readableError(caught)); })
      .finally(() => { if (active) setKnowledgeLoading(false); });
    return () => { active = false; };
  }, [chunkOffset, currentLocation]);

  useEffect(() => {
    const flush = () => {
      const position = progressSnapshotRef.current;
      if (position) void saveCourseReadingProgress(COURSE_SLUG, position, { keepalive: true }).catch(() => undefined);
    };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      progressWriteVersionRef.current += 1;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flush();
    };
  }, []);

  useEffect(() => {
    if (!currentChunk) return;
    progressSnapshotRef.current = {
      chapter: currentChunk.chapter,
      chunk_id: currentChunk.chunk_id,
      paragraph_index: paragraphIndex,
      source_expanded: sourceExpanded || hasOriginal,
    };
  }, [currentChunk, paragraphIndex, sourceExpanded]);

  useCourseReaderPosition({
    bodyRef: readingBodyRef,
    chunkId: currentChunk?.chunk_id ?? null,
    conceptId: currentConcept?.concept_id ?? null,
    paragraphIndex,
    paragraphCount: visibleParagraphs.length,
    resumeApplied,
    sourceExpanded: sourceExpanded || hasOriginal,
    startAtSource: sourcePageNavigation,
    onParagraphChange: trackVisibleParagraph,
  });

  function persistPosition(position: Parameters<typeof saveCourseReadingProgress>[1], keepalive = false) {
    progressSnapshotRef.current = position;
    const writeVersion = ++progressWriteVersionRef.current;
    void saveCourseReadingProgress(COURSE_SLUG, position, { keepalive })
      .then(() => {
        if (!keepalive && writeVersion === progressWriteVersionRef.current) {
          setProgressStatus("ready");
          setPersistedReadingPosition({
            chunkId: position.chunk_id,
            paragraphIndex: position.paragraph_index,
            sourceExpanded: position.source_expanded,
          });
        }
      })
      .catch(() => { if (!keepalive && writeVersion === progressWriteVersionRef.current) setProgressStatus("save_error"); });
  }

  function saveCurrentPosition() {
    if (progressSnapshotRef.current) persistPosition(progressSnapshotRef.current);
  }

  function selectConcept(location: ConceptLocation) {
    setSourcePageNavigation(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveCurrentPosition();
    progressWriteVersionRef.current += 1;
    if (currentConcept) setVisitedConceptIds((current) => new Set(current).add(currentConcept.concept_id));
    pendingResumeRef.current = null;
    setResumeApplied(false);
    setPersistedReadingPosition(null);
    setSelectedConceptId(location.concept.concept_id);
    setChunkOffset(location.concept.sources[0]?.chunk_offset ?? 0);
    setExpandedChapters((current) => new Set(current).add(location.chapter.chapter_id));
    setExpandedModules((current) => new Set(current).add(location.module.module_id));
  }

  function selectSourcePage(offset: number) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveCurrentPosition();
    progressWriteVersionRef.current += 1;
    pendingResumeRef.current = null;
    setResumeApplied(false);
    setPersistedReadingPosition(null);
    setSourcePageNavigation(true);
    setChunkOffset(offset);
  }

  function toggleSource() {
    if (!currentChunk) return;
    const nextExpanded = !sourceExpanded;
    const nextParagraph = nextExpanded
      ? Math.max(paragraphIndex, Math.min(SOURCE_PREVIEW_PARAGRAPHS, Math.max(0, readingParagraphs.length - 1)))
      : Math.min(paragraphIndex, SOURCE_PREVIEW_PARAGRAPHS - 1);
    setSourceExpanded(nextExpanded);
    setParagraphIndex(nextParagraph);
    persistPosition({ chapter: currentChunk.chapter, chunk_id: currentChunk.chunk_id, paragraph_index: nextParagraph, source_expanded: nextExpanded });
  }

  function trackVisibleParagraph(nextParagraph: number) {
    if (!currentChunk || (!sourceExpanded && !hasOriginal) || nextParagraph === paragraphIndex) return;
    progressWriteVersionRef.current += 1;
    setParagraphIndex(nextParagraph);
    const position = { chapter: currentChunk.chapter, chunk_id: currentChunk.chunk_id, paragraph_index: nextParagraph, source_expanded: true };
    progressSnapshotRef.current = position;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistPosition(position), 450);
  }

  if (error) {
    return <div className="page-inner course-domain-state" data-visual-system="ochre-serif" role="alert"><strong>{error}</strong><button onClick={() => setReloadKey((value) => value + 1)} type="button">重新读取课程</button></div>;
  }
  const course = catalog?.courses.find((candidate) => candidate.slug === COURSE_SLUG) ?? null;
  if (!course || !curriculum || !currentLocation) {
    return <div className="page-inner course-domain-state" data-visual-system="ochre-serif" role="status">正在读取计算机网络课程知识地图与上次阅读位置…</div>;
  }

  const lessonContent = currentConcept?.learning_content;
  const explanation = lessonContent?.explanation ?? [];
  const currentConceptIndex = currentConcept ? conceptLocations.findIndex((location) => location.concept.concept_id === currentConcept.concept_id) : -1;
  const primaryFigure = currentConcept?.figure_guidance?.primary ?? null;

  return (
    <div className="page-inner course-study-page" data-visual-system="ochre-serif">
      <Link className="course-back-link" to="/student/home"><ArrowLeft aria-hidden="true" size={15} />返回 408 课程首页</Link>
      <header className="course-study-heading">
        <div>
          <span className="first-release-kicker">{course.course_code} · 课程学习</span>
          <h1>{course.title}</h1>
          <p>围绕分层、链路、路由、运输与应用，按课程知识地图逐步建立端到端网络机制。</p>
        </div>
        <dl>
          <div><dt>核心知识点</dt><dd>{curriculum.concept_count}</dd></div>
          <div><dt>学习章节</dt><dd>{curriculum.chapters.length}</dd></div>
          <div><dt>关联题目</dt><dd>{course.question_count}</dd></div>
        </dl>
      </header>

      {resumeApplied ? <div className="reading-progress-status is-resumed" role="status"><strong>继续上次阅读</strong><span>已定位到「{currentConcept?.title}」的上次阅读位置。</span></div> : null}
      {progressStatus === "load_error" ? <div className="reading-progress-status is-warning" role="status"><strong>未能读取上次进度</strong><span>已从首个核心知识点继续，课程内容不受影响。</span></div> : null}
      {progressStatus === "save_error" ? <div className="reading-progress-status is-warning" role="status"><strong>本次阅读位置暂未保存</strong><span>你可以继续阅读，下一次操作时会再次保存。</span></div> : null}

      <CourseReaderWorkspace collapsed={chapterMapCollapsed}>
        <nav aria-label="计算机网络课程知识地图" className="chapter-map-panel" data-collapsed={chapterMapCollapsed}>
          <header>
            {!chapterMapCollapsed ? <div className="chapter-map-heading-copy"><h2>课程目录</h2><p><span>{curriculum.chapters.length} 章</span><span>{curriculum.concept_count} 个知识点</span></p></div> : null}
            <button aria-label={chapterMapCollapsed ? "展开课程目录" : "收起课程目录"} className="chapter-map-toggle" onClick={() => setChapterMapCollapsed((value) => !value)} type="button">
              {chapterMapCollapsed ? <PanelLeftOpen aria-hidden="true" size={18} /> : <PanelLeftClose aria-hidden="true" size={18} />}
            </button>
          </header>
          {chapterMapCollapsed ? <div aria-hidden="true" className="chapter-map-collapsed-label"><span>知识树</span><strong>{curriculum.concept_count}</strong></div> : (
            <ul className="curriculum-tree">
              {curriculum.chapters.map((chapter) => {
                const chapterExpanded = expandedChapters.has(chapter.chapter_id);
                const chapterCurrent = currentLocation.chapter.chapter_id === chapter.chapter_id;
                return <li className="curriculum-tree-chapter" key={chapter.chapter_id}>
                  <button aria-label={`${chapter.ordinal} ${chapter.source_chapter}，${chapter.modules.length} 个学习模块`} aria-expanded={chapterExpanded} className={`curriculum-chapter-toggle${chapterCurrent ? " active" : ""}`} data-node-level="chapter" onClick={() => setExpandedChapters((current) => { const next = new Set(current); if (next.has(chapter.chapter_id)) next.delete(chapter.chapter_id); else next.add(chapter.chapter_id); return next; })} type="button">
                    <span className="curriculum-chapter-index">{String(chapter.ordinal).padStart(2, "0")}</span><span className="curriculum-tree-disclosure">{chapterExpanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}</span><span className="curriculum-node-copy"><strong>{chapter.title}</strong></span>
                  </button>
                  {chapterExpanded ? <ul aria-label={`${chapter.title}学习模块`} className="curriculum-tree-modules">
                    {chapter.modules.map((module) => {
                      const moduleExpanded = expandedModules.has(module.module_id);
                      const moduleCurrent = currentLocation.module.module_id === module.module_id;
                      return <li className="curriculum-tree-module" key={module.module_id}>
                        <button aria-expanded={moduleExpanded} className={`curriculum-module-toggle${moduleCurrent ? " active" : ""}`} data-node-level="module" onClick={() => setExpandedModules((current) => { const next = new Set(current); if (next.has(module.module_id)) next.delete(module.module_id); else next.add(module.module_id); return next; })} type="button"><span className="curriculum-tree-disclosure">{moduleExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}</span><span className="curriculum-node-copy"><strong>{module.title}</strong></span></button>
                        {moduleExpanded ? <ul aria-label={`${module.title}核心知识点`} className="curriculum-tree-concepts">
                          {module.concepts.map((concept) => {
                            const isCurrent = currentConcept?.concept_id === concept.concept_id;
                            const isVisited = visitedConceptIds.has(concept.concept_id);
                            return <li className={`curriculum-concept-leaf${isCurrent ? " is-current" : isVisited ? " is-visited" : ""}`} key={concept.concept_id}>
                              <button aria-current={isCurrent ? "page" : undefined} className={`curriculum-concept-button${isCurrent ? " active" : ""}`} data-node-level="concept" data-state={isCurrent ? "current" : isVisited ? "visited" : "unread"} onClick={() => selectConcept({ chapter, module, concept })} type="button"><span aria-hidden="true" className="curriculum-concept-marker" /><span className="curriculum-node-copy"><strong>{concept.title}</strong><small className="course-node-meta">{concept.importance === "core" ? "核心" : "拓展"}{isCurrent ? ` · ${resumeApplied ? "继续" : "当前"}` : isVisited ? " · 已阅读" : ""}</small></span></button>
                            </li>;
                          })}
                        </ul> : null}
                      </li>;
                    })}
                  </ul> : null}
                </li>;
              })}
            </ul>
          )}
        </nav>

        <section aria-label="课程讲解" className="course-lesson-panel">
          <CourseReaderHeading
            chapter={currentLocation.chapter.title}
            module={currentLocation.module.title}
            title={currentLocation.concept.title}
          />
          {knowledgeLoading ? <div className="lesson-loading" role="status">正在读取知识点…</div> : currentChunk && knowledge && currentConcept ? <>

            <div className="lesson-reading-body" key={currentChunk.chunk_id} tabIndex={0} aria-label="知识点正文" ref={readingBodyRef}>
              <section aria-labelledby="cn-lesson-objective" className="lesson-orientation">
                <div className="lesson-objective-copy"><span>{currentConcept.importance === "core" ? "核心知识点" : "拓展知识点"}</span><h3 id="cn-lesson-objective">本节学习目标</h3><p>{currentConcept.learning_objective}</p></div>
                <div className="lesson-priority-line"><strong>关键概念</strong><div aria-label="本节关键概念">{currentConcept.key_terms.map((term) => <span key={term}>{term}</span>)}</div><p className={`lesson-learning-note is-${currentConcept.learning_note.kind}`}><strong>{currentConcept.learning_note.kind === "misconception" ? "易错点" : "学习提醒"}</strong>{currentConcept.learning_note.text}</p></div>
                <CourseVideoResources conceptId={currentConcept.concept_id} courseSlug={COURSE_SLUG} />
                <CourseAiExplanation courseId="course_408_cn" conceptId={currentConcept.concept_id} />
                {explanation.length > 0 ? <div className="ds-curated-explanation"><strong>先这样理解</strong>{explanation.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div> : null}
                {lessonContent?.case_prompt ? <div className="lesson-related-example"><div><span>练一练</span><strong>{lessonContent.case_prompt}</strong></div><div className="lesson-related-actions"><Link to={trainingHref}>进入课程训练 <ArrowRight aria-hidden="true" size={15} /></Link></div></div> : null}
              </section>

              {primaryFigure ? <section aria-labelledby="cn-lesson-figures" className="lesson-figure-ledger"><header><div><h3 id="cn-lesson-figures">相关图示</h3></div></header><div className="lesson-figure-list is-primary"><CourseFigure label={primaryFigure.figure_label} caption={primaryFigure.caption} src={studentImageUrl(primaryFigure.storage_ref)} width={primaryFigure.pixel_width} height={primaryFigure.pixel_height} /></div></section> : null}

              {currentChunk.source_page ? <CourseSourceDocument
                  key={currentChunk.chunk_id}
                  page={currentChunk.source_page}
                  paragraphCount={readingParagraphs.length}
                  chunkId={currentChunk.chunk_id}
                  sources={currentConcept.sources}
                  onSelectSource={selectSourcePage}
                /> : (<section aria-labelledby="cn-source-title" className="lesson-source-excerpt"><header><div><h3 id="cn-source-title">课程原文</h3></div><div className="lesson-source-meta">{hiddenParagraphCount > 0 ? <button aria-expanded={sourceExpanded} onClick={toggleSource} type="button">{sourceExpanded ? "收起原文" : `继续阅读原文（还有 ${hiddenParagraphCount} 段）`}</button> : null}</div></header><div className="lesson-source-paragraphs" id="cn-source-original">{visibleParagraphs.map((paragraph, index) => <p data-reading-paragraph={index} key={`${currentChunk.chunk_id}-${index}`}>{paragraph}</p>)}</div></section>)} 
            </div>
            <footer className="lesson-pagination"><button disabled={currentConceptIndex <= 0} onClick={() => { const next = conceptLocations[currentConceptIndex - 1]; if (next) selectConcept(next); }} type="button"><ChevronLeft aria-hidden="true" size={15} />上一知识点</button><span aria-label="知识点位置">{currentConceptIndex + 1} / {conceptLocations.length}</span><button disabled={currentConceptIndex < 0 || currentConceptIndex + 1 >= conceptLocations.length} onClick={() => { const next = conceptLocations[currentConceptIndex + 1]; if (next) selectConcept(next); }} type="button">下一知识点<ChevronRight aria-hidden="true" size={15} /></button></footer>
          </> : <div className="lesson-loading">当前知识点暂无内容。</div>}
        </section>
      </CourseReaderWorkspace>

      <section className="course-training-strip course-practice-footer" aria-label="课程练习"><Link to={trainingHref}>进入计算机网络课程训练 <ArrowRight aria-hidden="true" size={16} /></Link></section>
    </div>
  );
}
