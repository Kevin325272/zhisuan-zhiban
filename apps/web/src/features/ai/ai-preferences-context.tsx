import { DEFAULT_STUDENT_AI_PREFERENCES, type StudentAiPreferences, type StudentAiPreferencesPatch } from "@xuetu/contracts";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clearAiWorkflowRequests, getStudentAiPreferences, updateStudentAiPreferences } from "../../api/client";
import { useAuth } from "../auth/auth-context";

interface PreferencesContext {
  preferences: StudentAiPreferences;
  status: "loading" | "ready" | "error";
  saving: boolean;
  error: string | null;
  reload: () => void;
  update: (patch: StudentAiPreferencesPatch) => Promise<void>;
}
const Context = createContext<PreferencesContext>({
  preferences: DEFAULT_STUDENT_AI_PREFERENCES, status: "ready", saving: false, error: null,
  reload: () => {}, update: async () => {},
});

function AccountPreferences({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_STUDENT_AI_PREFERENCES);
  const [status, setStatus] = useState<PreferencesContext["status"]>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const writing = useRef(false);
  const alive = useRef(true);

  const reload = useCallback(() => {
    if (writing.current) return;
    const current = ++sequence.current;
    getStudentAiPreferences().then((data) => {
      if (!alive.current || current !== sequence.current) return;
      setPreferences(data); setStatus("ready"); setError(null);
    }).catch(() => {
      if (!alive.current || current !== sequence.current) return;
      setStatus("error"); setError("学习偏好暂时无法读取，请重试。");
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    window.addEventListener("focus", reload);
    return () => { alive.current = false; ++sequence.current; window.removeEventListener("focus", reload); };
  }, [reload]);

  const update = useCallback(async (patch: StudentAiPreferencesPatch) => {
    if (writing.current) return;
    writing.current = true; ++sequence.current;
    setSaving(true); setError(null);
    try {
      const data = await updateStudentAiPreferences(patch);
      clearAiWorkflowRequests();
      if (alive.current) { setPreferences(data); setStatus("ready"); }
    } catch {
      if (alive.current) setError("保存失败，设置尚未更改，请重试。");
    } finally {
      writing.current = false;
      if (alive.current) setSaving(false);
    }
  }, []);

  return <Context.Provider value={{ preferences, status, saving, error, reload, update }}>{children}</Context.Provider>;
}

export function AiPreferencesProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  return account?.roles.includes("student") && !account.must_change_password
    ? <AccountPreferences key={account.user_id}>{children}</AccountPreferences> : children;
}

export const useAiPreferences = () => useContext(Context);
