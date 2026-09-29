import { ArrowRight, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { DEMO_IDENTITIES, type DemoRole } from "../../lib/demo-identities";
import { getStudentOnboardingState } from "../../api/client";
import { createDemoSession, getDemoRoleHome } from "./demo-session";
import { LOGIN_NOTICE_COPY, type LoginNoticeCode } from "./auth-notices";
import { useAuth } from "./auth-context";
import { AuthGatewayLayout } from "./auth-gateway-layout";
import { SKIP_ONBOARDING } from "../onboarding/onboarding-skip";

const roleCopy = {
  student: {
    title: "学生",
    detail: "进入 408 课程首页，从课程讲解、案例逐步走到真实题库训练。",
    action: "以学生身份进入课程首页",
    icon: GraduationCap,
  },
  admin: {
    title: "管理员",
    detail: "查看题库来源、课程资料与已有学习情况。",
    action: "以管理员身份进入工作台",
    icon: ShieldCheck,
  },
} as const;

export function LoginPage() {
  const auth = useAuth();
  if (!auth.isProviderMounted) return <LegacyLoginPage />;
  return <AccountLoginPage />;
}

function AccountLoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const locationState = location.state as { from?: string; notice?: LoginNoticeCode } | null;
  const noticeCode = locationState?.notice ?? auth.loginNotice;
  const [notice] = useState(() => (
    noticeCode ? LOGIN_NOTICE_COPY[noticeCode] ?? null : null
  ));

  useEffect(() => {
    if (!noticeCode) return;
    auth.consumeLoginNotice();
    if (locationState?.notice) {
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: locationState.from ? { from: locationState.from } : null,
      });
    }
  }, [auth, location.pathname, location.search, locationState?.from, locationState?.notice, navigate, noticeCode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const account = await auth.login({ username, password });
      const from = locationState?.from;
      if (account.must_change_password) {
        navigate("/account/password", { replace: true });
        return;
      }
      if (account.roles.includes("admin")) {
        navigate(from?.startsWith("/admin") ? from : "/admin", { replace: true });
        return;
      }
      if (account.roles.includes("teacher")) {
        navigate(from?.startsWith("/teacher") ? from : "/teacher", { replace: true });
        return;
      }
      let destination = SKIP_ONBOARDING ? "/student/home" : "/student/onboarding";
      if (!SKIP_ONBOARDING) {
        try {
          const onboarding = await getStudentOnboardingState();
          if (onboarding.status === "completed") {
            destination = from?.startsWith("/student/") && from !== "/student/onboarding"
              ? from
              : "/student/home";
          }
        } catch {
          // The focused onboarding route owns the retry boundary after login.
        }
      }
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请稍后重试。");
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthGatewayLayout>
      <form aria-busy={submitting} aria-labelledby="login-form-title" className="login-gateway-form account-auth-form" onSubmit={submit}>
        <div className="login-gateway-form-heading"><span className="login-gateway-form-mark"><Sparkles aria-hidden="true" size={21} /></span><h2 id="login-form-title">欢迎回来</h2></div>
        <label>
          <span>用户名</span>
          <input
            autoCapitalize="none"
            autoComplete="username"
            name="username"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="请输入用户名"
            required
            spellCheck={false}
            value={username}
          />
        </label>
        <label>
          <span>密码</span>
          <input autoComplete="current-password" minLength={1} name="password" onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" required type="password" value={password} />
        </label>
        {notice ? <p className="account-auth-success" role="status">{notice}</p> : null}
        {error ? <p className="account-auth-error" role="alert">{error}</p> : null}
        <button className="login-gateway-submit" disabled={submitting} type="submit">
          {submitting ? "正在登录…" : "登录"}<ArrowRight aria-hidden="true" size={17} />
        </button>
        <p className="account-auth-switch">还没有账户？ <Link to="/register">注册账户</Link></p>
      </form>
    </AuthGatewayLayout>
  );
}

function LegacyLoginPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<DemoRole>("student");
  const selected = roleCopy[role];

  const enterWorkspace = () => {
    createDemoSession(role);
    navigate(getDemoRoleHome(role));
  };

  return (
    <main className="first-release-page login-entry-page" data-visual-system="ochre-serif">
      <section className="login-entry-sheet" aria-labelledby="login-title">
        <div className="login-entry-thesis">
          <span className="first-release-kicker">智算智伴 · 计算机科学与技术</span>
          <h1 id="login-title">进入智算智伴</h1>
          <p>选择使用端。</p>
        </div>

        <div className="login-entry-control">
          <div className="identity-selector" role="radiogroup" aria-label="选择身份">
            {(Object.keys(roleCopy) as DemoRole[]).map((value) => {
              const Icon = roleCopy[value].icon;
              return (
                <label key={value} className={role === value ? "selected" : ""}>
                  <input
                    aria-label={roleCopy[value].title}
                    checked={role === value}
                    name="demo-role"
                    onChange={() => setRole(value)}
                    type="radio"
                    value={value}
                  />
                  <Icon aria-hidden="true" size={18} />
                  <span><strong>{roleCopy[value].title}</strong><small>{DEMO_IDENTITIES[value].userId}</small></span>
                </label>
              );
            })}
          </div>

          <div className="identity-selection-copy" aria-live="polite">
            <strong>{selected.title}入口</strong>
            <p>{selected.detail}</p>
          </div>

          <button className="first-release-primary-action" onClick={enterWorkspace} type="button">
            {selected.action}<ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </section>
    </main>
  );
}
