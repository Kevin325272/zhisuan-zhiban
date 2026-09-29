import type { ReactNode } from "react";
import type { OnboardingState } from "@xuetu/contracts";
import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { getStudentOnboardingState } from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { SKIP_ONBOARDING } from "./onboarding-skip";

type GateState = "loading" | "completed" | "incomplete" | "error";

function hasCompleteLearningSetup(state: OnboardingState) {
  return state.status === "completed"
    && state.goals !== null
    && state.profile !== null
    && state.plan !== null
    && state.plan.tasks.length > 0;
}

export function StudentOnboardingGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (SKIP_ONBOARDING) return children;
  const [gateState, setGateState] = useState<GateState>("loading");

  const load = useCallback(async () => {
    setGateState("loading");
    try {
      const onboarding = await getStudentOnboardingState();
      setGateState(hasCompleteLearningSetup(onboarding) ? "completed" : "incomplete");
    } catch {
      setGateState("error");
    }
  }, []);

  useEffect(() => {
    if (!auth.isProviderMounted || !auth.account?.roles.includes("student")) return;
    void load();
  }, [auth.account?.user_id, auth.isProviderMounted, load]);

  if (!auth.isProviderMounted || !auth.account?.roles.includes("student")) {
    return children;
  }
  if (gateState === "loading") {
    return (
      <main className="onboarding-gate-state" aria-busy="true">
        <span className="onboarding-gate-spinner" aria-hidden="true" />
        <p>正在恢复你的学习起点…</p>
      </main>
    );
  }
  if (gateState === "error") {
    return (
      <main className="onboarding-gate-state">
        <p role="alert">暂时无法读取首次诊断状态，现有学习数据没有被修改。</p>
        <button type="button" onClick={() => void load()}>重新读取</button>
      </main>
    );
  }
  if (gateState === "incomplete") {
    return <Navigate replace to="/student/onboarding" />;
  }
  return children;
}
