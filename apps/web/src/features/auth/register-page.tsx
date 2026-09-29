import { ArrowLeft, ArrowRight, CheckCircle2, School, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AuthRegisterRequest, StudentRegistrationPolicy } from "@xuetu/contracts";

import { getStudentRegistrationPolicy } from "../../api/client";
import { useAuth } from "./auth-context";
import { AuthGatewayLayout } from "./auth-gateway-layout";
import { SKIP_ONBOARDING } from "../onboarding/onboarding-skip";

type RegistrationRole = AuthRegisterRequest["role"];

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<RegistrationRole>("student");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [teacherSubmitted, setTeacherSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationPolicy, setRegistrationPolicy] = useState<StudentRegistrationPolicy | null>(null);
  const [registrationPolicyError, setRegistrationPolicyError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    if (!auth.isProviderMounted) return;
    let cancelled = false;
    setRegistrationPolicy(null);
    setRegistrationPolicyError(null);
    void getStudentRegistrationPolicy()
      .then((policy) => {
        if (!cancelled) setRegistrationPolicy(policy);
      })
      .catch(() => {
        if (!cancelled) setRegistrationPolicyError("暂时无法读取注册状态，请稍后重试。");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.isProviderMounted]);

  if (!auth.isProviderMounted) {
    return <RegistrationStatus title="暂时无法注册" detail="请从正在运行的智算智伴入口重新进入。" />;
  }

  if (teacherSubmitted) {
    return (
      <RegistrationStatus
        title="教师申请已提交"
        detail="管理员会核验教师身份并分配课程和班级，审核通过后即可使用教师账户登录。"
        success
      />
    );
  }

  if (!registrationPolicy && !registrationPolicyError) {
    return <RegistrationStatus title="创建账户" detail="正在读取注册状态，请稍候。" />;
  }

  if (registrationPolicyError || !registrationPolicy) {
    return (
      <RegistrationStatus
        title="暂时无法注册"
        detail={registrationPolicyError ?? "请稍后重试。"}
      />
    );
  }

  const studentRegistrationControlled = role === "student" && !registrationPolicy.self_registration;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await auth.register({
        role,
        username,
        display_name: displayName,
        password,
        password_confirmation: confirmation,
      });
      if (result.next_step === "await_teacher_approval") {
        setTeacherSubmitted(true);
        return;
      }
      navigate(SKIP_ONBOARDING ? "/student/home" : "/student/onboarding", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注册失败，请检查输入。");
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthGatewayLayout registration>
      <section className="login-gateway-form account-auth-form registration-gateway-form" aria-labelledby="register-title">
        <div className="registration-gateway-heading">
          <div className="login-gateway-form-heading">
            <span className="login-gateway-form-mark">
              {role === "student" ? <Sparkles aria-hidden="true" size={21} /> : <School aria-hidden="true" size={21} />}
            </span>
            <h2 id="register-title">{role === "student" ? "开始你的 408 备考" : "申请教师账户"}</h2>
          </div>
          <p className="registration-gateway-description">
            {role === "student"
              ? "创建账户后，先完成目标、备考阶段和四门课程的起步设置。"
              : "提交申请后，管理员会核验身份并分配课程和班级。"}
          </p>
        </div>

        {studentRegistrationControlled ? (
          <div className="registration-controlled-message">
            <strong>本次校内试点使用邀请账号</strong>
            <p>{registrationPolicy.notice}</p>
            <Link className="login-gateway-submit" to="/login">
              返回登录 <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <button
              className="registration-secondary-action"
              onClick={() => { setRole("teacher"); setError(null); }}
              type="button"
            >
              <School aria-hidden="true" size={17} />
              <span>教师申请入口</span>
              <ArrowRight aria-hidden="true" size={16} />
            </button>
          </div>
        ) : (
          <form aria-busy={submitting} aria-labelledby="register-title" className="registration-fields" onSubmit={submit}>
            {role === "teacher" ? (
              <p className="registration-review-note">申请提交后暂不能登录，审核通过后再进入教师端。</p>
            ) : null}
            <label>
              <span>用户名</span>
              <input
                autoCapitalize="none"
                autoComplete="username"
                aria-describedby="register-username-note"
                name="username"
                onChange={(event) => setUsername(event.target.value)}
                pattern={"[^\\p{C}\\s]{1,32}"}
                placeholder="设置你的用户名"
                required
                spellCheck={false}
                value={username}
              />
            </label>
            <p className="registration-password-note" id="register-username-note">用户名 1–32 位，不能包含空格。</p>
            <label>
              <span>{role === "student" ? "姓名或昵称" : "姓名"}</span>
              <input autoComplete="name" name="display_name" onChange={(event) => setDisplayName(event.target.value)} placeholder={role === "student" ? "我们该怎么称呼你" : "请输入真实姓名"} required value={displayName} />
            </label>
            <div className="registration-password-fields">
              <label>
                <span>密码</span>
                <input autoComplete="new-password" aria-describedby="register-password-note" minLength={6} name="password" onChange={(event) => setPassword(event.target.value)} placeholder="设置密码" required type="password" value={password} />
              </label>
              <label>
                <span>确认密码</span>
                <input autoComplete="new-password" aria-describedby="register-password-note" minLength={6} name="password_confirmation" onChange={(event) => setConfirmation(event.target.value)} placeholder="再次输入密码" required type="password" value={confirmation} />
              </label>
            </div>
            <p className="registration-password-note" id="register-password-note">密码至少 6 位，不能包含空格。</p>
            {error ? <p className="account-auth-error" role="alert">{error}</p> : null}
            <button className="login-gateway-submit" disabled={submitting} type="submit">
              {submitting
                ? role === "student" ? "正在创建…" : "正在提交…"
                : role === "student" ? "创建学习账户" : "提交教师申请"}
              <ArrowRight aria-hidden="true" size={17} />
            </button>
            <div className="registration-entry-links">
              <p className="account-auth-switch">
                {role === "student" ? "已有账户？ " : "已有教师账户？ "}
                <Link to="/login">返回登录</Link>
              </p>
              {role === "student" ? (
                <button
                  className="registration-secondary-action"
                  disabled={submitting}
                  onClick={() => { setRole("teacher"); setError(null); }}
                  type="button"
                >
                  <School aria-hidden="true" size={17} />
                  <span>教师申请入口</span>
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ) : (
                <button
                  className="registration-secondary-action"
                  disabled={submitting}
                  onClick={() => { setRole("student"); setError(null); }}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={16} />
                  <span>返回学生注册</span>
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </AuthGatewayLayout>
  );
}

function RegistrationStatus({
  title,
  detail,
  success = false,
}: {
  title: string;
  detail: string;
  success?: boolean;
}) {
  return (
    <AuthGatewayLayout registration>
      <section className="login-gateway-form registration-gateway-form registration-result" aria-labelledby="register-title">
        <div className="login-gateway-form-heading">
          <span className="login-gateway-form-mark">
            {success ? <CheckCircle2 aria-hidden="true" size={23} /> : <Sparkles aria-hidden="true" size={21} />}
          </span>
          <h2 id="register-title">{title}</h2>
        </div>
        <p className="registration-gateway-description" role="status">{detail}</p>
        <Link className="login-gateway-submit" to="/login">
          返回登录 <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </section>
    </AuthGatewayLayout>
  );
}
