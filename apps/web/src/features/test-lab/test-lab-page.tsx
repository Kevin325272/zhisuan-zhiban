import { Navigate } from "react-router-dom";

const VIRTUAL_LAB_PATH = "/student/programming-experiments";

export function TestLabPage() {
  return <Navigate replace to={VIRTUAL_LAB_PATH} />;
}
