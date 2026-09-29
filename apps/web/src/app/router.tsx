import { Navigate, createBrowserRouter, useSearchParams } from "react-router-dom";
import { lazy, Suspense } from "react";

import { AppShell } from "../components/app-shell";
import { AdminEntryPage } from "../features/admin/admin-entry-page";
import { LoginPage } from "../features/auth/login-page";
import { RegisterPage } from "../features/auth/register-page";
import { PasswordChangeGate, RoleGate } from "../features/auth/role-gate";
import { CoursesPage } from "../features/course/courses-page";
import { CourseMapPage } from "../features/course/course-map-page";
import { ComputerOrganizationPage } from "../features/course/computer-organization-page";
import { ComputerNetworksPage } from "../features/course/computer-networks-page";
import { DataStructuresPage } from "../features/course/data-structures-page";
import { OperatingSystemsPage } from "../features/course/operating-systems-page";
import { ExamPaperPage } from "../features/exam-papers/exam-paper-page";
import { HomePage } from "../features/home/home-page";
import { MistakesPage } from "../features/mistakes/mistakes-page";
import { PlanPage } from "../features/plan/plan-page";
import { PracticePage } from "../features/practice/practice-page";
import { PhotoTutorPage } from "../features/practice/photo-tutor-page";
import { PilotStudyPage } from "../features/pilot-study/pilot-study-page";
import { PersonalLearningPage } from "../features/profile/personal-learning-page";
import { ProgrammingExperimentHubPage } from "../features/programming-experiment/programming-experiment-hub-page";
import { ProgrammingExperimentPage } from "../features/programming-experiment/programming-experiment-page";
import { TestLabPage } from "../features/test-lab/test-lab-page";
import { WorkbenchPage } from "../features/workbench/workbench-page";
import { AccountPage } from "../features/auth/account-page";
import { StudentOnboardingGate } from "../features/onboarding/student-onboarding-gate";
import { StudentOnboardingPage } from "../features/onboarding/student-onboarding-page";
import { TeacherEntryPage } from "../features/teacher/teacher-entry-page";
import { NotebookPage } from "../features/notebook/notebook-page";
import { QuestionMapPage } from "../features/study-library/question-map-page";
import { CollectionsPage } from "../features/study-library/collections-page";
const MemoryCardsPage = lazy(() => import("../features/study-library/memory-cards-page").then(module => ({ default: module.MemoryCardsPage })));

function StudentMaterialsFallback() {
  const [searchParams] = useSearchParams();
  const destination = searchParams.has("source")
    ? "/student/courses/data-structures"
    : "/student/courses";
  return <Navigate replace to={destination} />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/register",
    element: <RegisterPage />,
  },
  {
    path: "/account/password",
    element: (
      <PasswordChangeGate>
        <AccountPage />
      </PasswordChangeGate>
    ),
  },
  {
    path: "/student/onboarding",
    element: (
      <RoleGate role="student">
        <StudentOnboardingPage />
      </RoleGate>
    ),
  },
  {
    path: "/student",
    element: (
      <RoleGate role="student">
        <StudentOnboardingGate>
          <AppShell />
        </StudentOnboardingGate>
      </RoleGate>
    ),
    children: [
      { index: true, element: <Navigate to="/student/home" replace /> },
      { path: "home", element: <HomePage /> },
      { path: "ask", element: <Navigate replace to="/student/courses" /> },
      { path: "courses", element: <CoursesPage /> },
      { path: "course-map", element: <CourseMapPage /> },
      {
        path: "courses/data-structures",
        element: <DataStructuresPage />,
      },
      {
        path: "programming-experiments",
        element: <ProgrammingExperimentHubPage />,
      },
      {
        path: "programming-experiments/:labId",
        element: <ProgrammingExperimentPage />,
      },
      {
        path: "courses/computer-organization",
        element: <ComputerOrganizationPage />,
      },
      {
        path: "courses/operating-systems",
        element: <OperatingSystemsPage />,
      },
      {
        path: "courses/computer-networks",
        element: <ComputerNetworksPage />,
      },
      { path: "practice", element: <PracticePage /> },
      { path: "practice/photo-tutor", element: <PhotoTutorPage /> },
      { path: "pilot-study", element: <PilotStudyPage /> },
      { path: "test-lab", element: <TestLabPage /> },
      { path: "materials", element: <StudentMaterialsFallback /> },
      { path: "exam-papers", element: <ExamPaperPage /> },
      { path: "tasks/:taskId", element: <WorkbenchPage /> },
      { path: "mistakes", element: <MistakesPage /> },
      { path: "plan", element: <PlanPage /> },
      { path: "evidence", element: <Navigate to="/student/profile" replace /> },
      { path: "ability", element: <Navigate to="/student/profile" replace /> },
      { path: "profile", element: <PersonalLearningPage /> },
      { path: "notebook", element: <NotebookPage /> },
      { path: "question-map", element: <QuestionMapPage /> },
      { path: "collections", element: <CollectionsPage /> },
      { path: "memory-cards", element: <Suspense fallback={<p className="study-page" role="status">正在打开记忆卡…</p>}><MemoryCardsPage /></Suspense> },
      { path: "account", element: <AccountPage embedded /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <RoleGate role="admin">
        <AdminEntryPage />
      </RoleGate>
    ),
  },
  {
    path: "/teacher",
    element: (
      <RoleGate role="teacher">
        <TeacherEntryPage />
      </RoleGate>
    ),
  },
]);
