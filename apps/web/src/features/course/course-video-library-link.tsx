import { Film } from "lucide-react";
import { Link } from "react-router-dom";

interface CourseVideoLibraryLinkProps {
  courseSlug: string;
  label?: string;
}

export function CourseVideoLibraryLink({
  courseSlug,
  label = "全部视频资源",
}: CourseVideoLibraryLinkProps) {
  return (
    <Link className="course-video-library-link" to={`/student/courses/${courseSlug}/videos`}>
      <Film aria-hidden="true" size={16} />
      <span>{label}</span>
    </Link>
  );
}
