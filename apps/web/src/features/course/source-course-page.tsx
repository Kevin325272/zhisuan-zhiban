import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Image as ImageIcon,
  Layers3,
  ListTree,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  getSourceCourseOutline,
  type SourceCourseOutlineData,
} from "../../api/client";

function trainingHref(subject: string) {
  return `/student/practice?subject=${encodeURIComponent(subject)}`;
}

function studentImageUrl(path: string) {
  return path;
}

function loadError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "课程结构暂时无法读取，请稍后重试。";
}

export function SourceCoursePage({ courseSlug }: { courseSlug: string }) {
  const [outline, setOutline] = useState<SourceCourseOutlineData | null>(null);
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setOutline(null);
    setError(null);
    getSourceCourseOutline(courseSlug)
      .then((result) => {
        if (!active) return;
        setOutline(result);
        setActiveChapter(result.chapters[0]?.chapter ?? null);
      })
      .catch((caught: unknown) => {
        if (active) setError(loadError(caught));
      });
    return () => { active = false; };
  }, [courseSlug, reloadKey]);

  if (error) {
    return (
      <div className="page-inner course-domain-state" role="alert">
        <strong>{error}</strong>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">
          重新读取课程结构
        </button>
      </div>
    );
  }
  if (!outline) {
    return (
      <div className="page-inner course-domain-state" role="status">
        正在读取课程结构…
      </div>
    );
  }

  const chapter = outline.chapters.find((item) => item.chapter === activeChapter)
    ?? outline.chapters[0]!;

  return (
    <div className="page-inner source-course-page">
      <Link className="course-back-link" to="/student/home">
        <ArrowLeft aria-hidden="true" size={15} />返回 408 课程首页
      </Link>

      <header className="source-course-heading">
        <div>
          <span className="first-release-kicker">{outline.course_code} · 课程结构</span>
          <h1>{outline.title}</h1>
          <p>{outline.summary}</p>
        </div>
        <dl aria-label="课程概况">
          <div><dt>章节</dt><dd>{outline.chapter_count}</dd></div>
          <div><dt>来源入口</dt><dd>{outline.source_entry_count}</dd></div>
          <div><dt>可用图示</dt><dd>{outline.displayable_figure_count}</dd></div>
        </dl>
      </header>

      <section className="source-course-status" aria-label="课程内容状态">
        <BookOpenCheck aria-hidden="true" size={18} />
        <div>
          <strong>{outline.notice}</strong>
          <span>按教材章节整理重点内容和配图。</span>
        </div>
        <small>{outline.source_title} · {outline.source_edition}</small>
      </section>

      <div className="source-course-workspace">
        <nav aria-label={`${outline.title}课程章节`} className="source-chapter-rail">
          <header>
            <ListTree aria-hidden="true" size={17} />
            <div><strong>课程章节</strong><small>按教材顺序进入</small></div>
          </header>
          <ol>
            {outline.chapters.map((item, index) => {
              const current = item.chapter === chapter.chapter;
              return (
                <li key={item.chapter}>
                  <button
                    aria-current={current ? "page" : undefined}
                    onClick={() => setActiveChapter(item.chapter)}
                    type="button"
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{item.chapter}</strong>
                    <small>{item.source_entry_count} 条来源</small>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="source-chapter-reading">
          <header>
            <div>
              <span className="first-release-kicker">章节内容</span>
              <h2>{chapter.chapter}</h2>
              <p>教材第 {chapter.page_start}–{chapter.page_end} 页</p>
            </div>
              <span><Layers3 aria-hidden="true" size={15} />{chapter.source_entry_count} 个内容点</span>
          </header>

          {chapter.entries.length > 0 ? (
            <ol className="source-entry-list">
              {chapter.entries.map((entry, index) => (
                <li key={entry.entry_id}>
                  <article className={entry.figure ? "has-figure" : undefined}>
                    <div className="source-entry-copy">
                      <span className="source-entry-number">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <small>教材第 {entry.print_page} 页</small>
                        <h3>{entry.title}</h3>
                        {entry.keywords.length > 0 ? (
                          <p>关键术语：{entry.keywords.join(" · ")}</p>
                        ) : null}
                        <span className="source-entry-boundary">
                          打开课程内容，结合图示理解这一节。
                        </span>
                      </div>
                    </div>
                    {entry.figure ? (
                      <figure aria-label={`${entry.figure.figure_label} ${entry.figure.caption}`}>
                        <div className="source-figure-label">
                          <ImageIcon aria-hidden="true" size={14} />
                          <strong>{entry.figure.figure_label}</strong>
                        </div>
                        <img
                          alt={`${entry.figure.figure_label} ${entry.figure.caption}`}
                          height={entry.figure.pixel_height}
                          loading="lazy"
                          src={studentImageUrl(entry.figure.image_url)}
                          width={entry.figure.pixel_width}
                        />
                        <figcaption>{entry.figure.caption}</figcaption>
                      </figure>
                    ) : null}
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <p className="source-entry-empty">该章暂无通过学生端显示条件的来源入口。</p>
          )}

          <footer className="source-course-training">
            <div>
              <span>课程内训练</span>
              <strong>用真实 408 选择题检验当前课程掌握情况</strong>
            </div>
            <Link to={trainingHref(outline.question_subject)}>
              进入{outline.title}课程训练 <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </footer>
        </section>
      </div>
    </div>
  );
}
