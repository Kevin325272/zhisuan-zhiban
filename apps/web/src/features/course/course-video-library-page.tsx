import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Film,
  RefreshCcw,
  Search,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  getCourseVideoSeries,
  getCourseVideoSeriesEpisodes,
  type CourseVideoEpisodesData,
  type CourseVideoSeriesData,
} from "../../api/client";

type LibraryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: CourseVideoSeriesData };

type EpisodeState =
  | { seriesId: string; page: number; status: "loading" }
  | { seriesId: string; page: number; status: "error" }
  | { seriesId: string; page: number; status: "ready"; data: CourseVideoEpisodesData };

const videoKindLabel = {
  teaching: "课程讲解",
  question_explanation: "习题讲解",
} as const;

type VideoKindFilter = "all" | keyof typeof videoKindLabel;

function readPositivePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function readKind(value: string | null): VideoKindFilter {
  return value === "teaching" || value === "question_explanation" ? value : "all";
}

export function CourseVideoLibraryPage() {
  const { courseSlug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const kind = readKind(searchParams.get("kind"));
  const page = readPositivePage(searchParams.get("page"));
  const [searchInput, setSearchInput] = useState(query);
  const [state, setState] = useState<LibraryState>({ status: "loading" });
  const [episodeState, setEpisodeState] = useState<EpisodeState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const episodeRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    getCourseVideoSeries(courseSlug, { q: query, kind, page, pageSize: 10 })
      .then((data) => {
        if (active) setState({ status: "ready", data });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => { active = false; };
  }, [courseSlug, kind, page, query, reloadKey]);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    episodeRequestRef.current += 1;
    setEpisodeState(null);
  }, [courseSlug, kind, page, query]);

  function updateLocation(next: { q: string; kind: VideoKindFilter; page: number }) {
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.kind !== "all") params.set("kind", next.kind);
    if (next.page > 1) params.set("page", String(next.page));
    setSearchParams(params);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateLocation({ q: searchInput.trim(), kind, page: 1 });
  }

  function loadEpisodes(seriesId: string, episodePage: number) {
    const requestId = episodeRequestRef.current + 1;
    episodeRequestRef.current = requestId;
    setEpisodeState({ seriesId, page: episodePage, status: "loading" });
    getCourseVideoSeriesEpisodes(courseSlug, seriesId, { page: episodePage, pageSize: 30 })
      .then((data) => {
        if (episodeRequestRef.current === requestId) {
          setEpisodeState({ seriesId, page: episodePage, status: "ready", data });
        }
      })
      .catch(() => {
        if (episodeRequestRef.current === requestId) {
          setEpisodeState({ seriesId, page: episodePage, status: "error" });
        }
      });
  }

  function toggleSeries(seriesId: string) {
    if (episodeState?.seriesId === seriesId) {
      episodeRequestRef.current += 1;
      setEpisodeState(null);
      return;
    }
    loadEpisodes(seriesId, 1);
  }

  if (state.status === "loading") {
    return (
      <section className="course-video-library-state" data-visual-system="ochre-serif" role="status">
        <Film aria-hidden="true" size={22} />
        <strong>正在读取课程视频资源…</strong>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="course-video-library-state is-error" data-visual-system="ochre-serif" role="alert">
        <RefreshCcw aria-hidden="true" size={22} />
        <strong>视频资源暂时无法读取</strong>
        <span>课程学习内容不受影响，可以重新读取视频列表。</span>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">重新读取</button>
      </section>
    );
  }

  const { data } = state;

  return (
    <section className="course-video-library-page" data-visual-system="ochre-serif">
      <Link className="course-video-library-back" to={`/student/courses/${courseSlug}`}>
        <ArrowLeft aria-hidden="true" size={15} />返回{data.course_title}课程
      </Link>

      <header className="course-video-library-heading">
        <div>
          <h1>{data.course_title}视频资源</h1>
        </div>
        <dl aria-label="视频资源概况">
          <div><dt>视频系列</dt><dd>{data.total_series}</dd></div>
          <div><dt>完整分集</dt><dd>{data.total_episodes}</dd></div>
        </dl>
      </header>

      <section aria-label="筛选视频资源" className="course-video-library-controls">
        <form onSubmit={submitSearch} role="search">
          <label htmlFor="course-video-search">搜索视频</label>
          <div>
            <Search aria-hidden="true" size={17} />
            <input
              autoComplete="off"
              id="course-video-search"
              name="q"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索系列、UP 主或分集标题…"
              type="search"
              value={searchInput}
            />
            <button type="submit">搜索</button>
          </div>
        </form>
        <fieldset>
          <legend>视频类型</legend>
          {([
            ["all", "全部"],
            ["teaching", "课程讲解"],
            ["question_explanation", "习题讲解"],
          ] as const).map(([value, label]) => (
            <label key={value}>
              <input
                checked={kind === value}
                name="course-video-kind"
                onChange={() => updateLocation({ q: query, kind: value, page: 1 })}
                type="radio"
                value={value}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <aside className="course-video-library-notice" role="note">
        <Film aria-hidden="true" size={17} />
        <p>视频链接将在哔哩哔哩打开。</p>
      </aside>

      <section aria-label="视频系列" className="course-video-series-ledger">
        {data.items.length === 0 ? (
          <div className="course-video-series-empty" role="status">
            <strong>没有找到匹配的视频系列</strong>
            <span>可以更换关键词或切回全部类型。</span>
          </div>
        ) : null}
        <ol>
          {data.items.map((series, index) => (
            <li key={series.series_id}>
              <article className={episodeState?.seriesId === series.series_id ? "is-expanded" : undefined}>
                <div className="course-video-series-row">
                  <span aria-hidden="true" className="course-video-series-index">
                    {String((data.page - 1) * data.page_size + index + 1).padStart(2, "0")}
                  </span>
                  <div className="course-video-series-copy">
                    <span>{videoKindLabel[series.video_kind]}</span>
                    <h2>{series.series_title}</h2>
                    <p>{series.uploader}</p>
                  </div>
                  <dl>
                    <div><dt>分集</dt><dd>{series.episode_count}</dd></div>
                    <div><dt>总时长</dt><dd>{series.total_duration}</dd></div>
                  </dl>
                  <button
                    aria-controls={`course-video-episodes-${series.series_id}`}
                    aria-expanded={episodeState?.seriesId === series.series_id}
                    aria-label={`${episodeState?.seriesId === series.series_id ? "收起" : "展开"}分集：${series.series_title}`}
                    onClick={() => toggleSeries(series.series_id)}
                    type="button"
                  >
                    {episodeState?.seriesId === series.series_id
                      ? <ChevronUp aria-hidden="true" size={17} />
                      : <ChevronDown aria-hidden="true" size={17} />}
                  </button>
                </div>

                {episodeState?.seriesId === series.series_id ? (
                  <section
                    aria-label={`${series.series_title}分集`}
                    className="course-video-episode-panel"
                    id={`course-video-episodes-${series.series_id}`}
                  >
                    {episodeState.status === "loading" ? (
                      <p role="status">正在读取分集…</p>
                    ) : episodeState.status === "error" ? (
                      <div className="course-video-episode-error">
                        <p role="alert">该系列分集暂时无法读取。</p>
                        <button onClick={() => loadEpisodes(series.series_id, episodeState.page)} type="button">
                          <RefreshCcw aria-hidden="true" size={15} />重新读取本系列
                        </button>
                      </div>
                    ) : (
                      <>
                        <ol>
                          {episodeState.data.items.map((episode) => (
                            <li key={episode.episode_id}>
                              <a
                                aria-label={`观看第 ${episode.episode_number} 集：${episode.episode_title}`}
                                href={episode.external_url}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                <span>{String(episode.episode_number).padStart(2, "0")}</span>
                                <strong>{episode.episode_title}</strong>
                                <small>{episode.duration}</small>
                                <ExternalLink aria-hidden="true" size={15} />
                              </a>
                            </li>
                          ))}
                        </ol>
                        <nav aria-label={`${series.series_title}分集分页`}>
                          <button
                            disabled={episodeState.data.page <= 1}
                            onClick={() => loadEpisodes(series.series_id, episodeState.data.page - 1)}
                            type="button"
                          >
                            <ChevronLeft aria-hidden="true" size={15} />上一页
                          </button>
                          <span>
                            第 {episodeState.data.page} 页，共 {episodeState.data.total_pages} 页
                          </span>
                          <button
                            disabled={episodeState.data.page >= episodeState.data.total_pages}
                            onClick={() => loadEpisodes(series.series_id, episodeState.data.page + 1)}
                            type="button"
                          >
                            下一页<ChevronRight aria-hidden="true" size={15} />
                          </button>
                        </nav>
                      </>
                    )}
                  </section>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      </section>

      <nav aria-label="视频系列分页" className="course-video-series-pagination">
        <button
          disabled={data.page <= 1}
          onClick={() => updateLocation({ q: query, kind, page: data.page - 1 })}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />上一页
        </button>
        <span>第 {data.page} 页{data.total_pages > 0 ? `，共 ${data.total_pages} 页` : ""}</span>
        <button
          disabled={data.total_pages === 0 || data.page >= data.total_pages}
          onClick={() => updateLocation({ q: query, kind, page: data.page + 1 })}
          type="button"
        >
          下一页<ChevronRight aria-hidden="true" size={16} />
        </button>
      </nav>
    </section>
  );
}
