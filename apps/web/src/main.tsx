import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { router } from "./app/router";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { AuthProvider } from "./features/auth/auth-context";
import { AiPreferencesProvider } from "./features/ai/ai-preferences-context";
import "./styles/global.css";
import "./styles/ui-fonts.css";
import "./styles/student-visual-tokens.css";
import "./styles/professional.css";
import "./styles/student-app-shell.css";
import "./styles/global-learning-experience.css";
import "./styles/first-release-workspaces.css";
import "./styles/course-learning.css";
import "./styles/ai-workflow-slots.css";
import "./styles/exam-paper-library.css";
import "./styles/reliable-learning-loop.css";
import "./styles/account-auth.css";
import "./styles/teacher-workspace.css";
import "./styles/personal-learning-center.css";
import "./styles/student-onboarding.css";
import "./styles/programming-experiment.css";
import "./features/home/home-orchestrator.css";
import "./features/home/student-care-panel.css";
import "./features/course/courses-overview.css";
import "./features/course/course-video-library.css";
import "./features/pilot-study/pilot-study.css";
import "./features/community/community.css";
import "./styles/student-visual-pages.css";
import "./styles/app-error-boundary.css";
import "./styles/learning-dashboard.css";
import "./styles/student-surface-consistency.css";
import "./styles/student-card-surfaces.css";
import "./styles/ai-settings.css";
import "./styles/student-workspace-polish.css";
import "./styles/student-typography.css";
import "./styles/login-gateway.css";
import "./styles/course-reader-workspace.css";
import "./styles/teacher-workspace-polish.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <AiPreferencesProvider><RouterProvider router={router} /></AiPreferencesProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
