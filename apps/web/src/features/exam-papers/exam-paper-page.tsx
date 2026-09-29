import { Navigate } from "react-router-dom";

export function ExamPaperPage() {
  // Keep existing bookmarks useful by sending students to the maintained
  // catalog, which is the only route that loads the real paper inventory.
  return <Navigate replace to="/student/practice?mode=past_exam" />;
}
