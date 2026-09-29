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

import { AiWorkflowSlot } from "../ai/ai-workflow-slot";
import {
  ApiError,
  get408Courses,
  getCourseCurriculumMap,
  getCourseKnowledge,
  getCourseQaExamples,
  getCourseReadingProgress,
  saveCourseReadingProgress,
  type CourseCatalogData,
  type CourseCurriculumMapData,
  type CourseKnowledgeData,
  type CourseQaData,
} from "../../api/client";
import {
  type PersistedCourseReadingPosition,
  useCourseReadingTaskSettlement,
} from "../learning/course-reading-task-settlement";
import { useStudentTaskProgress } from "../learning/student-task-progress";
import {
  buildReadingParagraphs,
  resolvePracticeRoute,
  selectRelatedQa,
} from "./course-reading";
import { CourseVideoResources } from "./course-video-resources";
import { CourseReaderHeading } from "./course-reader-heading";
import { CourseReaderWorkspace } from "./course-reader-workspace";
import { useCourseReaderPosition } from "./use-course-reader-position";
import { CourseFigure } from "./course-figure";

const COURSE_SLUG = "computer-organization";
const TRAINING_HREF = "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86";
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
  return "课程内容暂时无法读取，请稍后重试。";
}

export function ComputerOrganizationPage() {
  const [searchParams] = useSearchParams();
  const orchestrationTaskId = searchParams.get("orchestration_task_id")?.trim() || null;
  const requestedConceptId = searchParams.get("concept_id")?.trim() || null;
  const taskProgress = useStudentTaskProgress(orchestrationTaskId);
  const [catalog, setCatalog] = useState<CourseCatalogData | null>(null);
  const [curriculum, setCurriculum] = useState<CourseCurriculumMapData | null>(null);
  const [qa, setQa] = useState<CourseQaData | null>(null);
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
  const [progressStatus, setProgressStatus] = useState<
    "loading" | "ready" | "load_error" | "save_error"
  >("loading");
  const [resumeApplied, setResumeApplied] = useState(false);
  const [persistedReadingPosition, setPersistedReadingPosition] = useState<PersistedCourseReadingPosition | null>(null);
  const pendingResumeRef = useRef<
    Awaited<ReturnType<typeof getCourseReadingProgress>>["progress"]
  >(null);
  const progressSnapshotRef = useRef<
    Parameters<typeof saveCourseReadingProgress>[1] | null
  >(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressWriteVersionRef = useRef(0);
  const readingBodyRef = useRef<HTMLDivElement | null>(null);

  const conceptLocations = useMemo(
    () => curriculum ? flattenConcepts(curriculum) : [],
    [curriculum],
  );
  const currentLocation = useMemo(
    () => conceptLocations.find(
      (location) => location.concept.concept_id === selectedConceptId,
    ) ?? null,
    [conceptLocations, selectedConceptId],
  );

  useEffect(() => {
    let active = true;
    setCatalog(null);
    setCurriculum(null);
    setQa(null);
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

    Promise.all([
      get408Courses(),
      getCourseCurriculumMap(COURSE_SLUG),
      getCourseQaExamples(COURSE_SLUG, { limit: 20, offset: 0 }),
      progressRequest,
    ])
      .then(([nextCatalog, nextCurriculum, nextQa, progressResult]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setCurriculum(nextCurriculum);
        setQa(nextQa);
        const locations = flattenConcepts(nextCurriculum);
        const fallback = locations[0] ?? null;
        const saved = progressResult.ok ? progressResult.result.progress : null;
        const requestedLocation = requestedConceptId
          ? locations.find((location) => location.concept.concept_id === requestedConceptId) ?? null
          : null;
        const savedLocation = saved && !requestedLocation
          ? locations.find((location) =>
              location.concept.sources.some((source) => source.chunk_id === saved.chunk_id),
            ) ?? null
          : null;
        const start = requestedLocation ?? savedLocation ?? fallback;
        if (!start) {
          setError("课程知识地图没有可学习的核心知识点。");
          return;
        }
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
    return () => {
      active = false;
    };
  }, [reloadKey, requestedConceptId]);

  useEffect(() => {
    if (!currentLocation) return undefined;
    let active = true;
    setSourceExpanded(false);
    setParagraphIndex(0);
    setResumeApplied(false);
    setPersistedReadingPosition(null);
    setKnowledgeLoading(true);
    setKnowledge(null);
    getCourseKnowledge(COURSE_SLUG, {
      chapter: currentLocation.chapter.source_chapter,
      limit: 1,
      offset: chunkOffset,
    })
      .then((result) => {
        if (!active) return;
        const chunk = result.items[0] ?? null;
        const saved = pendingResumeRef.current;
        if (saved && chunk?.chunk_id === saved.chunk_id) {
          const paragraphCount = buildReadingParagraphs(chunk.text).length;
          const restoredParagraph = Math.min(
            saved.paragraph_index,
            Math.max(0, paragraphCount - 1),
          );
          setSourceExpanded(
            saved.source_expanded || restoredParagraph >= SOURCE_PREVIEW_PARAGRAPHS,
          );
          setParagraphIndex(restoredParagraph);
          setPersistedReadingPosition({
            chunkId: saved.chunk_id,
            paragraphIndex: restoredParagraph,
            sourceExpanded: saved.source_expanded,
          });
          setResumeApplied(true);
          pendingResumeRef.current = null;
        } else if (saved && result.items.length === 0) {
          pendingResumeRef.current = null;
          setProgressStatus("load_error");
          setChunkOffset(currentLocation.concept.sources[0]?.chunk_offset ?? 0);
          return;
        }
        setKnowledge(result);
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught));
      })
      .finally(() => {
        if (active) setKnowledgeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chunkOffset, currentLocation]);

  useEffect(() => {
    const flush = () => {
      const position = progressSnapshotRef.current;
      if (!position) return;
      void saveCourseReadingProgress(COURSE_SLUG, position, { keepalive: true }).catch(() => {
        // 页面离开时只做尽力保存；可见交互失败会在页面内明确提示。
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      progressWriteVersionRef.current += 1;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flush();
    };
  }, []);

  const course = useMemo(
    () => catalog?.courses.find((candidate) => candidate.slug === COURSE_SLUG) ?? null,
    [catalog],
  );
  const currentChunk = knowledge?.items[0] ?? null;
  const hasOriginal = Boolean(currentChunk?.source_page);
  const currentConcept = currentLocation?.concept ?? null;
  const trainingRoute = currentConcept
    ? resolvePracticeRoute(TRAINING_HREF, currentConcept)
    : { href: TRAINING_HREF, mode: "course" as const, questionCount: 0 };
  const trainingHref = trainingRoute.href;
  const readingParagraphs = useMemo(
    () => currentChunk ? buildReadingParagraphs(currentChunk.text) : [],
    [currentChunk],
  );
  const lessonTerms = currentConcept?.key_terms ?? [];
  const primaryFigure = currentConcept?.figure_guidance?.primary ?? null;
  const relatedFigures = currentConcept?.figure_guidance?.related ?? [];
  const relatedQa = useMemo(
    () => selectRelatedQa(qa?.items ?? [], lessonTerms),
    [lessonTerms, qa],
  );
  const visibleParagraphs = sourceExpanded || hasOriginal
    ? readingParagraphs
    : readingParagraphs.slice(0, SOURCE_PREVIEW_PARAGRAPHS);
  const hiddenParagraphCount = Math.max(
    0,
    readingParagraphs.length - SOURCE_PREVIEW_PARAGRAPHS,
  );
  const visibleExamples = useMemo(() => {
    if (!qa) return [];
    if (!relatedQa.example) return qa.items.slice(0, 3);
    return [
      relatedQa.example,
      ...qa.items.filter((item) => item.qa_id !== relatedQa.example?.qa_id),
    ].slice(0, 3);
  }, [qa, relatedQa.example]);
  const currentConceptIndex = currentConcept
    ? conceptLocations.findIndex(
        (location) => location.concept.concept_id === currentConcept.concept_id,
      )
    : -1;
  useCourseReadingTaskSettlement({
    taskId: orchestrationTaskId,
    taskStatus: taskProgress.status,
    completeTask: taskProgress.complete,
    currentChunkId: currentChunk?.chunk_id ?? null,
    persistedPosition: persistedReadingPosition,
  });

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

  function persistPosition(
    position: Parameters<typeof saveCourseReadingProgress>[1],
    keepalive = false,
  ) {
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
      .catch(() => {
        if (!keepalive && writeVersion === progressWriteVersionRef.current) setProgressStatus("save_error");
      });
  }

  function saveCurrentPosition() {
    const position = progressSnapshotRef.current;
    if (position) persistPosition(position);
  }

  function selectConcept(location: ConceptLocation) {
    setSourcePageNavigation(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveCurrentPosition();
    progressWriteVersionRef.current += 1;
    if (currentConcept) {
      setVisitedConceptIds((current) => new Set(current).add(currentConcept.concept_id));
    }
    pendingResumeRef.current = null;
    setResumeApplied(false);
    setPersistedReadingPosition(null);
    setSelectedConceptId(location.concept.concept_id);
    setChunkOffset(location.concept.sources[0]?.chunk_offset ?? 0);
    setExpandedChapters((current) => new Set(current).add(location.chapter.chapter_id));
    setExpandedModules((current) => new Set(current).add(location.module.module_id));
  }

  function toggleChapter(chapterId: string) {
    setExpandedChapters((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  function toggleModule(moduleId: string) {
    setExpandedModules((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  function moveConcept(nextIndex: number) {
    const next = conceptLocations[nextIndex];
    if (next) selectConcept(next);
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
      ? Math.max(
          paragraphIndex,
          Math.min(
            SOURCE_PREVIEW_PARAGRAPHS,
            Math.max(0, readingParagraphs.length - 1),
          ),
        )
      : Math.min(paragraphIndex, SOURCE_PREVIEW_PARAGRAPHS - 1);
    setSourceExpanded(nextExpanded);
    setParagraphIndex(nextParagraph);
    persistPosition({
      chapter: currentChunk.chapter,
      chunk_id: currentChunk.chunk_id,
      paragraph_index: nextParagraph,
      source_expanded: nextExpanded,
    });
  }

  function trackVisibleParagraph(nextParagraph: number) {
    if (!currentChunk || (!sourceExpanded && !hasOriginal) || nextParagraph === paragraphIndex) return;
    progressWriteVersionRef.current += 1;
    setParagraphIndex(nextParagraph);
    const position = {
      chapter: currentChunk.chapter,
      chunk_id: currentChunk.chunk_id,
      paragraph_index: nextParagraph,
      source_expanded: true,
    };
    progressSnapshotRef.current = position;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistPosition(position), 450);
  }

  if (error) {
    return (
      <div className="page-inner course-domain-state" data-visual-system="ochre-serif" role="alert">
        <strong>{error}</strong>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">
          重新读取课程
        </button>
      </div>
    );
  }
  if (!course || !curriculum || !qa || !currentLocation) {
    return (
      <div className="page-inner course-domain-state" data-visual-system="ochre-serif" role="status">
        正在读取课程知识地图与上次阅读位置…
      </div>
    );
  }

  return (
    <div className="page-inner course-study-page" data-visual-system="ochre-serif">
      <Link className="course-back-link" to="/student/home">
        <ArrowLeft aria-hidden="true" size={15} />返回 408 课程首页
      </Link>

      <header className="course-study-heading">
        <div>
          <span className="first-release-kicker">{course.course_code} · 课程学习</span>
          <h1>{course.title}</h1>
          <p>{course.summary}</p>
        </div>
        <dl>
          <div><dt>核心知识点</dt><dd>{curriculum.concept_count}</dd></div>
          <div><dt>课程问答</dt><dd>{course.qa_example_count}</dd></div>
          <div><dt>关联题目</dt><dd>{course.question_count}</dd></div>
        </dl>
      </header>

      {resumeApplied ? (
        <div className="reading-progress-status is-resumed" role="status">
          <strong>继续上次阅读</strong>
          <span>
            已定位到「{currentLocation.concept.title}」的上次阅读位置。
          </span>
        </div>
      ) : progressStatus === "load_error" ? (
        <div className="reading-progress-status is-warning" role="status">
          <strong>未能读取上次进度</strong>
          <span>已从首个核心知识点继续，课程内容不受影响。</span>
        </div>
      ) : progressStatus === "save_error" ? (
        <div className="reading-progress-status is-warning" role="status">
          <strong>本次阅读位置暂未保存</strong>
          <span>你可以继续阅读，下一次操作时会再次保存。</span>
        </div>
      ) : null}

      <CourseReaderWorkspace collapsed={chapterMapCollapsed}>
        <nav
          aria-label="组成原理知识地图"
          className="chapter-map-panel"
          data-collapsed={chapterMapCollapsed}
        >
          <header>
            {!chapterMapCollapsed ? (
              <div className="chapter-map-heading-copy">
                <h2>课程目录</h2>
                <p>
                  <span>{curriculum.chapters.length} 章</span>
                  <span>{curriculum.concept_count} 个知识点</span>
                </p>
              </div>
            ) : null}
            <button
              aria-label={chapterMapCollapsed ? "展开课程目录" : "收起课程目录"}
              className="chapter-map-toggle"
              onClick={() => setChapterMapCollapsed((value) => !value)}
              title={chapterMapCollapsed ? "展开课程目录" : "收起课程目录"}
              type="button"
            >
              {chapterMapCollapsed
                ? <PanelLeftOpen aria-hidden="true" size={18} />
                : <PanelLeftClose aria-hidden="true" size={18} />}
            </button>
          </header>
          {chapterMapCollapsed ? (
            <div aria-hidden="true" className="chapter-map-collapsed-label">
              <span>知识树</span>
              <strong>{curriculum.concept_count}</strong>
            </div>
          ) : (
            <ul className="curriculum-tree">
              {curriculum.chapters.map((chapter) => {
                const chapterExpanded = expandedChapters.has(chapter.chapter_id);
                const chapterCurrent =
                  currentLocation.chapter.chapter_id === chapter.chapter_id;
                return (
                  <li className="curriculum-tree-chapter" key={chapter.chapter_id}>
                    <button
                      aria-label={`${chapter.ordinal} ${chapter.title}，${chapter.modules.length} 个学习模块`}
                      aria-expanded={chapterExpanded}
                      className={`curriculum-chapter-toggle${chapterCurrent ? " active" : ""}`}
                      data-node-level="chapter"
                      onClick={() => toggleChapter(chapter.chapter_id)}
                      type="button"
                    >
                      <span className="curriculum-chapter-index">
                        {String(chapter.ordinal).padStart(2, "0")}
                      </span>
                      <span className="curriculum-tree-disclosure">
                        {chapterExpanded
                          ? <ChevronDown aria-hidden="true" size={15} />
                          : <ChevronRight aria-hidden="true" size={15} />}
                      </span>
                      <span className="curriculum-node-copy">
                        <strong>{chapter.title}</strong>

                      </span>
                    </button>
                    {chapterExpanded ? (
                      <ul
                        aria-label={`${chapter.title}学习模块`}
                        className="curriculum-tree-modules"
                      >
                        {chapter.modules.map((module) => {
                          const moduleExpanded = expandedModules.has(module.module_id);
                          const moduleCurrent =
                            currentLocation.module.module_id === module.module_id;
                          return (
                            <li className="curriculum-tree-module" key={module.module_id}>
                              <button
                                aria-expanded={moduleExpanded}
                                className={`curriculum-module-toggle${moduleCurrent ? " active" : ""}`}
                                data-node-level="module"
                                onClick={() => toggleModule(module.module_id)}
                                type="button"
                              >
                                <span className="curriculum-tree-disclosure">
                                  {moduleExpanded
                                    ? <ChevronDown aria-hidden="true" size={14} />
                                    : <ChevronRight aria-hidden="true" size={14} />}
                                </span>
                                <span className="curriculum-node-copy">
                                  <strong>{module.title}</strong>

                                </span>
                              </button>
                              {moduleExpanded ? (
                                <ul
                                  aria-label={`${module.title}核心知识点`}
                                  className="curriculum-tree-concepts"
                                >
                                  {module.concepts.map((concept) => {
                                    const isCurrent =
                                      currentConcept?.concept_id === concept.concept_id;
                                    const isVisited = visitedConceptIds.has(concept.concept_id);
                                    const location = { chapter, module, concept };
                                    return (
                                      <li
                                        className={`curriculum-concept-leaf${
                                          isCurrent
                                            ? " is-current"
                                            : isVisited
                                              ? " is-visited"
                                              : ""
                                        }`}
                                        key={concept.concept_id}
                                      >
                                        <button
                                          aria-current={isCurrent ? "page" : undefined}
                                          className={`curriculum-concept-button${isCurrent ? " active" : ""}`}
                                          data-node-level="concept"
                                          data-state={
                                            isCurrent ? "current" : isVisited ? "visited" : "unread"
                                          }
                                          onClick={() => selectConcept(location)}
                                          type="button"
                                        >
                                          <span
                                            aria-hidden="true"
                                            className="curriculum-concept-marker"
                                          />
                                          <span className="curriculum-node-copy">
                                            <strong>{concept.title}</strong>
                                            <small className="course-node-meta">
                                              {concept.importance === "core" ? "核心" : "拓展"}
                                              {isCurrent
                                                ? ` · ${resumeApplied ? "继续" : "当前"}`
                                                : isVisited
                                                  ? " · 已阅读"
                                                  : ""}
                                            </small>
                                          </span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
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

          {knowledgeLoading ? (
            <div className="lesson-loading" role="status">正在读取知识点…</div>
          ) : currentChunk && knowledge && currentConcept ? (
            <>

              <div
                className="lesson-reading-body"
                key={currentChunk.chunk_id}
                tabIndex={0} aria-label="知识点正文"
                ref={readingBodyRef}
              >
                <section aria-labelledby="lesson-objective-title" className="lesson-orientation">
                  <div className="lesson-objective-copy">
                    <span>{currentConcept.importance === "core" ? "核心知识点" : "拓展知识点"}</span>
                    <h3 id="lesson-objective-title">本节学习目标</h3>
                    <p>{currentConcept.learning_objective}</p>
                  </div>

                  <div className="lesson-priority-line">
                    <strong>本节重点</strong>
                    <div aria-label="本节关键概念">
                      {lessonTerms.map((term) => <span key={term}>{term}</span>)}
                    </div>
                    <p className={`lesson-learning-note is-${currentConcept.learning_note.kind}`}>
                      <strong>
                        {currentConcept.learning_note.kind === "misconception"
                          ? "易混点"
                          : "学习提醒"}
                      </strong>
                      {currentConcept.learning_note.text}
                    </p>
                  </div>

                  <CourseVideoResources
                    conceptId={currentConcept.concept_id}
                    courseSlug={COURSE_SLUG}
                  />

                  <AiWorkflowSlot
                    manual
                    actionLabel="讲解这个知识点"
                    invocation={{
                      contract_version: "0.2",
                      capability: "explain",
                      course_id: "course_408_co",
                      concept_id: currentConcept.concept_id,
                      qa_id: null,
                      attempt_id: null,
                      user_message: null,
                    }}
                    slot="contextual_explanation"
                    title="上下文讲解"
                  />

                  {relatedQa.example ? (
                    <div className="lesson-related-example">
                      <div>
                        <span>思考题</span>
                        <strong>{relatedQa.example.question}</strong>
                      </div>
                      <div className="lesson-related-actions">
                        <a href={`#course-example-${relatedQa.example.qa_id}`}>
                          查看解析 <ArrowRight aria-hidden="true" size={15} />
                        </a>
                        <Link to={trainingHref}>
                          进入课程训练 <ArrowRight aria-hidden="true" size={15} />
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </section>

                {primaryFigure ? (
                  <section aria-labelledby="lesson-figures-title" className="lesson-figure-ledger">
                    <header>
                      <div>
                        <h3 id="lesson-figures-title">相关图示</h3>

                      </div>
                    </header>
                    <div className="lesson-figure-list is-primary">
                      <CourseFigure label={primaryFigure.figure_label} caption={primaryFigure.caption} src={primaryFigure.storage_ref} width={primaryFigure.pixel_width} height={primaryFigure.pixel_height} />
                    </div>
                    {relatedFigures.length > 0 ? (
                      <details className="lesson-related-figures">
                        <summary>更多相关图示（{relatedFigures.length}）</summary>
                        <div className="lesson-figure-list is-related">
                          {relatedFigures.map((figure) => (
                            <CourseFigure key={figure.figure_label} label={figure.figure_label} caption={figure.caption} src={figure.storage_ref} width={figure.pixel_width} height={figure.pixel_height} />
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </section>
                ) : null}

                {currentChunk.source_page ? <CourseSourceDocument
                  key={currentChunk.chunk_id}
                  page={currentChunk.source_page}
                  paragraphCount={readingParagraphs.length}
                  chunkId={currentChunk.chunk_id}
                  sources={currentConcept.sources}
                  onSelectSource={selectSourcePage}
                /> : (<section aria-labelledby="lesson-source-title" className="lesson-source-excerpt">
                  <header>
                    <div>
                      <h3 id="lesson-source-title">课程原文</h3>

                    </div>
                    <div className="lesson-source-meta">
                      <small>{currentChunk.chapter}</small>
                      {hiddenParagraphCount > 0 ? (
                        <button
                          aria-controls="lesson-source-original"
                          aria-expanded={sourceExpanded}
                          onClick={toggleSource}
                          type="button"
                        >
                          {sourceExpanded
                            ? "收起原文"
                            : `继续阅读原文（还有 ${hiddenParagraphCount} 段）`}
                        </button>
                      ) : null}
                    </div>
                  </header>
                  <div className="lesson-source-paragraphs" id="lesson-source-original">
                    {visibleParagraphs.map((paragraph, index) => (
                      <p
                        data-reading-paragraph={index}
                        key={`${currentChunk.chunk_id}-${index}`}
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>)} 
              </div>
              <footer className="lesson-pagination">
                <button
                  disabled={currentConceptIndex <= 0}
                  onClick={() => moveConcept(currentConceptIndex - 1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={15} />上一知识点
                </button>
                <span aria-label="知识点位置">{currentConceptIndex + 1} / {conceptLocations.length}</span>
                <button
                  disabled={currentConceptIndex < 0 || currentConceptIndex + 1 >= conceptLocations.length}
                  onClick={() => moveConcept(currentConceptIndex + 1)}
                  type="button"
                >
                  下一知识点<ChevronRight aria-hidden="true" size={15} />
                </button>
              </footer>
            </>
          ) : (
            <div className="lesson-loading">当前知识点暂无内容。</div>
          )}
        </section>
      </CourseReaderWorkspace>

      <section aria-label="课程案例问答" className="course-example-section">
        <header>
          <div>
            <h2>案例问答</h2>
          </div>
          <span>{qa.total} 组课程问答</span>
        </header>
        <AiWorkflowSlot
          invocation={currentConcept && visibleExamples[0] ? {
            contract_version: "0.2",
            capability: "coach",
            course_id: "course_408_co",
            concept_id: currentConcept.concept_id,
            qa_id: visibleExamples[0].qa_id,
            attempt_id: null,
            user_message: null,
          } : null}
          manual
          slot="guided_case"
          title="分步引导与追问"
        />
        <div className="course-example-list">
          {visibleExamples.map((example, index) => (
            <article id={`course-example-${example.qa_id}`} key={example.qa_id}>
              <span>示例 {String(index + 1).padStart(2, "0")} · 问什么</span>
              <h3>{example.question}</h3>
              <p><strong>如何理解</strong>{example.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="course-training-strip course-practice-footer" aria-label="课程练习">
        <Link to={trainingHref}>
          进入组成原理课程训练 <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </section>

    </div>
  );
}
