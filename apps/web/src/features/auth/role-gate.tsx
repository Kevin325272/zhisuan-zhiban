import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import type { PlatformRole } from "@xuetu/contracts";

import type { DemoRole } from "../../lib/demo-identities";
import { getDemoRoleHome, readDemoSession } from "./demo-session";
import { useAuth } from "./auth-context";

function accountHome(roles: readonly PlatformRole[]) {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("teacher")) return "/teacher";
  return "/student/home";
}

export function RoleGate({ role, children }: { role: DemoRole | "teacher"; children: ReactNode }) {
  const location = useLocation();
  const auth = useAuth();

  // Unit-level consumers that render RoleGate without the application
  // provider keep the old fixture-only behavior. The real app is always
  // wrapped by AuthProvider and therefore never reads sessionStorage.
  if (!auth.isProviderMounted) {
    const session = readDemoSession();
    if (!session) return <Navigate replace state={{ from: location.pathname }} to="/login" />;
    if (session.role !== role) return <Navigate replace to={getDemoRoleHome(session.role)} />;
    return children;
  }

  if (auth.status === "loading") {
    return <div aria-busy="true" className="auth-gate-loading">正在核对登录状态…</div>;
  }
  if (!auth.account) {
    return <Navigate replace state={{
      from: location.pathname,
      ...(auth.loginNotice ? { notice: auth.loginNotice } : {}),
    }} to="/login" />;
  }
  if (auth.account.must_change_password && location.pathname !== "/account/password") {
    return <Navigate replace to="/account/password" />;
  }
  if (!auth.account.roles.includes(role)) {
    return <Navigate replace to={accountHome(auth.account.roles)} />;
  }
  return children;
}

export function PasswordChangeGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const auth = useAuth();
  if (auth.status === "loading") {
    return <div aria-busy="true" className="auth-gate-loading">正在核对登录状态…</div>;
  }
  if (!auth.account) {
    return <Navigate replace state={{
      from: location.pathname,
      ...(auth.loginNotice ? { notice: auth.loginNotice } : {}),
    }} to="/login" />;
  }
  if (!auth.account.must_change_password) {
    return <Navigate replace to={accountHome(auth.account.roles)} />;
  }
  return children;
}
