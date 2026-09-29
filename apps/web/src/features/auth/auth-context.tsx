import type { AuthAccount, AuthRegisterRequest, AuthRegistrationResponse } from "@xuetu/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  changeAccountPassword,
  clearAiWorkflowRequests,
  getAuthSession,
  loginAccount,
  logoutAccount,
  registerAccount,
} from "../../api/client";
import { setLearningOutputOwner } from "../../lib/learning-output-store";
import { setCodeDraftOwner } from "../../lib/code-draft-store";
import { clearMockExamDraft } from "../../lib/mock-exam-draft-store";
import type { LoginNoticeCode } from "./auth-notices";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  isProviderMounted: boolean;
  status: AuthStatus;
  account: AuthAccount | null;
  loginNotice: LoginNoticeCode | null;
  error: string | null;
  refresh: (options?: { optional?: boolean }) => Promise<AuthAccount | null>;
  login: (input: { username: string; password: string }) => Promise<AuthAccount>;
  register: (input: AuthRegisterRequest) => Promise<AuthRegistrationResponse>;
  logout: () => Promise<void>;
  consumeLoginNotice: () => void;
  changePassword: (input: {
    current_password: string;
    new_password: string;
    new_password_confirmation: string;
  }) => Promise<AuthAccount>;
}

const defaultContext: AuthContextValue = {
  isProviderMounted: false,
  status: "unauthenticated",
  account: null,
  loginNotice: null,
  error: null,
  refresh: async () => null,
  login: async () => { throw new Error("AuthProvider is not mounted."); },
  register: async () => { throw new Error("AuthProvider is not mounted."); },
  logout: async () => undefined,
  consumeLoginNotice: () => undefined,
  changePassword: async () => { throw new Error("AuthProvider is not mounted."); },
};

const AuthContext = createContext<AuthContextValue>(defaultContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [loginNotice, setLoginNotice] = useState<LoginNoticeCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accountRef = useRef<AuthAccount | null>(null);

  const applyAccount = useCallback((next: AuthAccount | null) => {
    if (accountRef.current && accountRef.current.user_id !== next?.user_id) {
      clearMockExamDraft(accountRef.current.user_id);
    }
    if (accountRef.current?.user_id !== next?.user_id) clearAiWorkflowRequests();
    accountRef.current = next;
    setAccount(next);
    setLearningOutputOwner(next?.user_id ?? null);
    setCodeDraftOwner(next?.user_id ?? null);
    setStatus(next ? "authenticated" : "unauthenticated");
  }, []);

  const refresh = useCallback(async (options: { optional?: boolean } = {}) => {
    setError(null);
    try {
      const result = options.optional
        ? await getAuthSession({ optional: true })
        : await getAuthSession();
      applyAccount(result.account);
      return result.account;
    } catch (cause) {
      if (cause instanceof ApiError && ["AUTHENTICATION_REQUIRED", "SESSION_INVALID"].includes(cause.code)) {
        applyAccount(null);
        return null;
      }
      setError(cause instanceof Error ? cause.message : "登录状态读取失败。");
      const currentAccount = accountRef.current;
      if (!currentAccount) setStatus("unauthenticated");
      return currentAccount;
    }
  }, [applyAccount]);

  useEffect(() => {
    void refresh({ optional: true });
  }, [refresh]);

  const login = useCallback(async (input: { username: string; password: string }) => {
    setError(null);
    setLoginNotice(null);
    const result = await loginAccount(input);
    applyAccount(result.account);
    return result.account;
  }, [applyAccount]);

  const register = useCallback(async (input: AuthRegisterRequest) => {
    setError(null);
    setLoginNotice(null);
    const result = await registerAccount(input);
    if (result.authenticated) applyAccount(result.account);
    return result;
  }, [applyAccount]);

  const logout = useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
      applyAccount(null);
    }
  }, [applyAccount]);

  const consumeLoginNotice = useCallback(() => {
    setLoginNotice(null);
  }, []);

  const changePassword = useCallback(async (input: {
    current_password: string;
    new_password: string;
    new_password_confirmation: string;
  }) => {
    const result = await changeAccountPassword(input);
    // The server revokes all sessions after a password change. Clear the
    // client identity immediately; AccountPage carries a fixed notice code
    // to the public login route before the protected page disappears.
    setLoginNotice("password_changed");
    applyAccount(null);
    return result.account;
  }, [applyAccount]);

  const value = useMemo<AuthContextValue>(() => ({
    isProviderMounted: true,
    status,
    account,
    loginNotice,
    error,
    refresh,
    login,
    register,
    logout,
    consumeLoginNotice,
    changePassword,
  }), [account, changePassword, consumeLoginNotice, error, login, loginNotice, logout, refresh, register, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
