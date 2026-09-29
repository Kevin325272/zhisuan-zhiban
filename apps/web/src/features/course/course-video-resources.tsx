import { ExternalLink, Play } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getCourseConceptVideos,
  type CourseConceptVideosData,
} from "../../api/client";
import { CourseVideoLibraryLink } from "./course-video-library-link";

type VideoLoadState =
  | { status: "loading" }
  | { status: "ready"; data: CourseConceptVideosData }
  | { status: "error" };

export function CourseVideoResources({
  courseSlug,
  conceptId,
}: {
  courseSlug: string;
  conceptId: string;
}) {
  const [state, setState] = useState<VideoLoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    getCourseConceptVideos(courseSlug, conceptId)
      .then((data) => {
        if (active) setState({ status: "ready", data });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => { active = false; };
  }, [conceptId, courseSlug]);

  if (state.status === "loading") {
    return <p className="course-video-status" role="status">正在读取相关视频…</p>;
  }
  if (state.status === "error") {
    return <p className="course-video-status is-error" role="status">
      相关视频暂时无法读取，不影响当前课程学习。
    </p>;
  }
  if (state.data.items.length === 0) return null;

  return (
    <section aria-labelledby={`course-videos-${conceptId}`} className="course-video-resources">
      <header>
        <div>
          <h3 id={`course-videos-${conceptId}`}>相关视频</h3>
        </div>
        <div className="course-video-resource-library">
          <CourseVideoLibraryLink courseSlug={courseSlug} label="查看本课程全部视频" />
        </div>
      </header>
      <ol>
        {state.data.items.slice(0, 2).map((video, index) => (
          <li key={video.episode_id}>
            <a
              aria-label={`观看讲解视频：${video.episode_title}（在哔哩哔哩打开）`}
              href={video.external_url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span aria-hidden="true" className="course-video-index">
                <Play size={14} />{String(index + 1).padStart(2, "0")}
              </span>
              <span className="course-video-copy">
                <strong>{video.episode_title}</strong>
                <small>{video.series_title} · 第 {video.episode_number} 集</small>
              </span>
              <span className="course-video-meta">{video.duration} · {video.uploader}</span>
              <span className="course-video-action">观看讲解视频 <ExternalLink aria-hidden="true" size={14} /></span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
