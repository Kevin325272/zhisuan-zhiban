import { DEMO_IDENTITIES, type DemoRole } from "../../lib/demo-identities";

const DEMO_SESSION_KEY = "xuetu.demo.session.v1";

export interface DemoSession {
  role: DemoRole;
  userId: (typeof DEMO_IDENTITIES)[DemoRole]["userId"];
  authentication: "local_development_demo";
  startedAt: string;
}

function isDemoSession(value: unknown): value is DemoSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoSession>;
  if (candidate.authentication !== "local_development_demo") return false;
  if (candidate.role !== "student" && candidate.role !== "admin") return false;
  return candidate.userId === DEMO_IDENTITIES[candidate.role].userId;
}

export function createDemoSession(role: DemoRole): DemoSession {
  const session: DemoSession = {
    role,
    userId: DEMO_IDENTITIES[role].userId,
    authentication: "local_development_demo",
    startedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function readDemoSession(): DemoSession | null {
  try {
    const raw = window.sessionStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDemoSession(parsed)) {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
    } catch {
      // Storage access can be blocked; that behaves as a signed-out session.
    }
    return null;
  }
}

export function clearDemoSession() {
  window.sessionStorage.removeItem(DEMO_SESSION_KEY);
}

export function getDemoRoleHome(role: DemoRole) {
  return role === "student" ? "/student/home" : "/admin";
}
