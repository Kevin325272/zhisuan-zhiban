import { KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { getAccountCourseScope, type AccountCourseScope } from "../../api/client";
import { useAuth } from "./auth-context";
import { AiSettingsPanel } from "../ai/ai-settings-panel";

type CourseScopeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: AccountCourseScope };

const ROLE_LABELS: Record<string, string> = {
  student: "学生",
  teacher: "教师",
  admin: "管理员",
};

export function AccountPage({ embedded = false }: { embedded?: boolean }) {
  const Container = embedded ? "section" : "main";
  const auth = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "account" ? "account" : "ai";
  const setTab = (value: "ai" | "account") => setParams({ tab: value }, { replace: true });
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [courseScope, setCourseScope] = useState<CourseScopeState>({ status: "loading" });

  useEffect(() => {
    if (!auth.account) {
      setCourseScope({ status: "loading" });
      return;
    }
    let active = true;
    setCourseScope({ status: "loading" });
    getAccountCourseScope()
      .then((data) => {
        if (active) setCourseScope({ status: "ready", data });
      })
      .catch(() => {
        if (active) setCourseScope({ status: "error" });
      });
    return () => { active = false; };
  }, [auth.account?.user_id]);

  if (!auth.account) return null;
  const showAi = embedded && auth.account.roles.includes("student") && !auth.account.must_change_password;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (next !== confirm) { setError("两次输入的新密码不一致。"); return; }
    submitting.current = true;
    setSaving(true);
    try {
      await auth.changePassword({
        current_password: current,
        new_password: next,
        new_password_confirmation: confirm,
      });
      navigate("/login", {
        replace: true,
        state: { notice: "password_changed" },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码更新失败。");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <Container className={`first-release-page account-page${showAi ? " student-settings-page" : ""}`} id={embedded ? undefined : "main-content"}>
      <header className="learning-page-heading">
        <h1>{auth.account.must_change_password ? "首次登录，请先修改密码" : showAi ? "账户设置" : "账户与安全"}</h1>
        {showAi ? <p>让学伴按你的习惯工作。</p> : null}
        {auth.account.must_change_password ? (
          <p>管理员为你设置的是临时密码。修改完成并重新登录后，才可进入学习或治理功能。</p>
        ) : null}
      </header>
      {showAi ? <nav className="settings-tabs" aria-label="设置分类"><button type="button" aria-pressed={tab === "ai"} onClick={() => setTab("ai")}><Sparkles size={18} />AI 学习助手</button><button type="button" aria-pressed={tab === "account"} onClick={() => setTab("account")}><ShieldCheck size={18} />账户与安全</button></nav> : null}
      {showAi && tab === "ai" ? <AiSettingsPanel /> : null}
      <div className="account-page-grid" hidden={showAi && tab !== "account"}>
        <section className="account-card" aria-labelledby="account-detail-title">
          <header><ShieldCheck aria-hidden="true" size={19} /><h2 id="account-detail-title">当前身份</h2></header>
          <dl>
            <div><dt>用户名</dt><dd>{auth.account.username}</dd></div>
            <div><dt>显示名称</dt><dd>{auth.account.display_name}</dd></div>
            <div><dt>角色</dt><dd>{auth.account.roles.map((role) => ROLE_LABELS[role] ?? role).join("、")}</dd></div>
            <div><dt>状态</dt><dd>{auth.account.account_status === "active" ? "启用" : "停用"}</dd></div>
            <div>
              <dt>我的课程</dt>
              <dd className="account-course-scope">
                {courseScope.status === "loading" ? "正在读取课程…" : null}
                {courseScope.status === "error" ? "课程暂时无法读取，请稍后重试。" : null}
                {courseScope.status === "ready" && courseScope.data.items.length === 0 ? "暂未分配课程" : null}
                {courseScope.status === "ready" && courseScope.data.items.length > 0 ? (
                  <>
                    {courseScope.data.items.map((course) => (
                      <span key={course.course_id}>{course.title}</span>
                    ))}
                  </>
                ) : null}
                {courseScope.status === "ready" && auth.account.roles.includes("teacher") ? (
                  <small className="account-scope-note">教师仅可查看所带课程和班级的学习情况。</small>
                ) : null}
              </dd>
            </div>
          </dl>
        </section>
        <form className="account-card account-password-form" onSubmit={submit}>
          <header><KeyRound aria-hidden="true" size={19} /><h2>修改密码</h2></header>
          <label><span>当前密码</span><input autoComplete="current-password" onChange={(event) => setCurrent(event.target.value)} required type="password" value={current} /></label>
          <label><span>新密码</span><input autoComplete="new-password" minLength={6} onChange={(event) => setNext(event.target.value)} required type="password" value={next} /></label>
          <label><span>确认新密码</span><input autoComplete="new-password" minLength={6} onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} /></label>
          {error ? <p className="account-auth-error" role="alert">{error}</p> : null}
          <button className="first-release-primary-action" disabled={saving} type="submit">{saving ? "正在更新…" : "更新密码"}</button>
        </form>
      </div>
    </Container>
  );
}
