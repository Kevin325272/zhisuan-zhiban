import {
  ArrowUpRight,
  BookOpenText,
  Database,
  Eye,
  EyeOff,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import type {
  AcademicClassOption,
  AuthAccount,
  CourseLearningSummary,
  ExamPaperManagementResponse,
  ManagedQuestionSummary,
  MaterialRecord,
  PilotManagementReport,
} from "@xuetu/contracts";

import {
  getManagedLearningSummary,
  getManagedMaterials,
  getManagedQuestions,
  getManagedAccounts,
  createManagedAccount,
  getManagedAcademicClasses,
  approveManagedTeacher,
  resetManagedAccountPassword,
  updateManagedAccountStatus,
  getPilotManagementReport,
} from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { getManagedExamPapers } from "../exam-papers/exam-paper-client";
import { PilotStudyGovernance } from "./pilot-study-governance";

const COURSE_ID = "course_408_001";

const DEMO_408_COURSES = [
  { id: "course_408_ds", label: "408 · 数据结构" },
  { id: "course_408_co", label: "408 · 计算机组成原理" },
  { id: "course_408_os", label: "408 · 操作系统" },
  { id: "course_408_cn", label: "408 · 计算机网络" },
] as const;

interface GovernanceData {
  questions: ManagedQuestionSummary[] | null;
  materials: MaterialRecord[] | null;
  summary: CourseLearningSummary | null;
  examPapers: ExamPaperManagementResponse | null;
  accounts: AuthAccount[] | null;
  academicClasses: AcademicClassOption[] | null;
  pilotReport: PilotManagementReport | null;
}

const reviewLabels: Record<ManagedQuestionSummary["review_status"], string> = {
  unreviewed: "未审核",
  pending_review: "待复核",
  approved: "已通过",
  rejected: "已驳回",
};

const roleLabels: Record<AuthAccount["roles"][number], string> = {
  student: "学生",
  teacher: "教师",
  admin: "管理员",
};

export function AdminEntryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<GovernanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const loadGovernanceData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [questionData, materialData, summary, examPapers, accountsData, academicClasses, pilotReport] = await Promise.allSettled([
        getManagedQuestions(COURSE_ID),
        getManagedMaterials(COURSE_ID),
        getManagedLearningSummary(COURSE_ID),
        getManagedExamPapers(),
        getManagedAccounts(),
        getManagedAcademicClasses(),
        getPilotManagementReport(true),
      ]);
      const results = [questionData, materialData, summary, examPapers, accountsData, academicClasses, pilotReport];
      if (results.every((result) => result.status === "rejected")) {
        setData(null);
        setError("管理内容暂时无法读取，请稍后重试。");
        return;
      }
      setData({
        questions: questionData.status === "fulfilled" ? questionData.value.items : null,
        materials: materialData.status === "fulfilled" ? materialData.value.items : null,
        summary: summary.status === "fulfilled" ? summary.value : null,
        examPapers: examPapers.status === "fulfilled" ? examPapers.value : null,
        accounts: accountsData.status === "fulfilled" ? accountsData.value.items : null,
        academicClasses: academicClasses.status === "fulfilled" ? academicClasses.value.items : null,
        pilotReport: pilotReport.status === "fulfilled" ? pilotReport.value : null,
      });
      const hasFailure = results.some((result) => result.status === "rejected");
      if (hasFailure) setError("已显示可用内容，可以重新读取缺失部分。");
    } catch (loadError) {
      setData(null);
      setError("管理内容暂时无法读取，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGovernanceData();
  }, [loadGovernanceData, requestVersion]);

  const retry = () => setRequestVersion((current) => current + 1);

  return (
    <main className="first-release-page admin-governance-page" id="main-content">
      <header className="first-release-topbar">
        <Link className="first-release-brand" to="/admin">
          <span aria-hidden="true">学</span>
          <span>
            <strong>智算智伴</strong>
            <small>计算机科学与技术</small>
          </span>
        </Link>
        <div className="first-release-session-meta">
          <span><ShieldCheck aria-hidden="true" size={15} /> {auth.account?.display_name ?? "管理员"}</span>
          <code>{auth.account?.username ?? "account"}</code>
          <Link aria-label="退出登录" onClick={(event) => { event.preventDefault(); void auth.logout().then(() => navigate("/login", { replace: true })); }} to="/login">
            <LogOut aria-hidden="true" size={15} />
            退出
          </Link>
        </div>
      </header>

      <div className="admin-governance-layout">
        <header className="admin-governance-intro">
          <div>
            <h1>管理员工作台</h1>
            <p>核对题库、课程资料与学习情况，并为教师分配课程和班级。</p>
          </div>
          <div className="admin-course-context">
            <span>当前课程</span>
            <strong>408 · 数据结构</strong>
          </div>
        </header>

        {loading ? (
          <section aria-live="polite" className="governance-status-line">
            <Database aria-hidden="true" size={18} />
            <span>正在读取管理数据…</span>
          </section>
        ) : null}

        {error ? (
          <section className="governance-error" role="alert">
            <div>
              <strong>{data ? "部分内容暂时无法读取" : "暂时无法读取管理内容"}</strong>
              <p>{error}</p>
            </div>
            <button onClick={retry} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              重新读取
            </button>
          </section>
        ) : null}

        {data ? <GovernanceLedger data={data} onChanged={retry} /> : null}
      </div>
    </main>
  );
}

function GovernanceLedger({ data, onChanged }: { data: GovernanceData; onChanged: () => void }) {
  const unverifiedCount = data.questions?.filter(
    (question) => question.license_status === "unverified",
  ).length ?? 0;
  const visibleQuestions = data.questions?.slice(0, 8) ?? [];

  return (
    <div className="governance-ledger">
      <section aria-labelledby="question-governance-title" className="governance-section">
        <header>
          <span className="governance-section-index">01</span>
          <div>
            <h2 id="question-governance-title">题库与来源审核</h2>
            <p>按审核和授权状态检查题目，优先处理尚未核验的内容。</p>
          </div>
          {data.questions ? (
            <div className="governance-totals">
              <strong>{data.questions.length} 道题</strong>
              <span>{unverifiedCount} 条授权待核验</span>
            </div>
          ) : null}
        </header>

        {data.questions ? (
          <>
            <div className="governance-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">题目标识</th>
                    <th scope="col">年份 / 题号</th>
                    <th scope="col">知识标签</th>
                    <th scope="col">审核</th>
                    <th scope="col">授权状态</th>
                    <th scope="col">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQuestions.map((question) => (
                    <tr key={question.question_id}>
                      <td><code>{question.question_id}</code></td>
                      <td>{question.year === null ? "自编题" : question.year} / {question.number}</td>
                      <td>{question.tags.slice(0, 2).join(" · ") || "未标注"}</td>
                      <td><span data-status={question.review_status}>{reviewLabels[question.review_status]}</span></td>
                      <td>{question.license_status === "unverified" ? "授权未核验" : question.license_status}</td>
                      <td>
                        <a href={question.source_url} rel="noreferrer" target="_blank">
                          原始页 <ArrowUpRight aria-hidden="true" size={13} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.questions.length > visibleQuestions.length ? (
              <p className="governance-table-note">当前展示前 {visibleQuestions.length} 条记录。</p>
            ) : null}
          </>
        ) : <SectionUnavailable label="题库内容" />}
      </section>

      <section aria-labelledby="exam-paper-governance-title" className="governance-section">
        <header>
          <span className="governance-section-index">02</span>
          <div>
            <h2 id="exam-paper-governance-title">自命题试卷与来源</h2>
            <p>按整卷保存的本地演示索引；不拆题、不提供答案，也不把材料用于训练。</p>
          </div>
          {data.examPapers ? (
            <div className="governance-totals">
              <strong>{data.examPapers.total} 份已收录整卷</strong>
              <span>授权待核验 {data.examPapers.license_unverified_count}</span>
            </div>
          ) : null}
        </header>

        {data.examPapers ? <div className="exam-paper-management">
          <div className="exam-paper-management-header">
            <div>
              <h3>来源与内容状态</h3>
              <p>试卷按整卷保存，可查看扫描状态、文字检索状态和授权审核进度。</p>
            </div>
            <div className="exam-paper-management-stats" aria-label="自命题试卷统计">
              <span>{data.examPapers.scan_count} 份扫描版</span>
              <span>{data.examPapers.text_layer_count} 份可检索文字</span>
              <span>授权待核验 {data.examPapers.license_unverified_count}</span>
            </div>
          </div>
          <div className="exam-paper-management-table-wrap">
            <table className="exam-paper-management-table">
              <thead>
                <tr>
                  <th scope="col">院校 / 科目</th>
                  <th scope="col">年份 / 类型</th>
                  <th scope="col">内容</th>
                  <th scope="col">审核</th>
                  <th scope="col">来源</th>
                </tr>
              </thead>
              <tbody>
                {data.examPapers.items.slice(0, 8).map((paper) => (
                  <tr key={paper.exam_paper_id}>
                    <td>
                      <strong>{paper.university}</strong>
                      <small>{paper.subject}</small>
                    </td>
                    <td>{paper.year} / {paper.paper_type === "sample" ? "样题" : "试题"}</td>
                    <td>{paper.content_mode === "scan" ? "扫描版" : "可检索文字"}<small>{paper.page_count} 页</small></td>
                    <td>{reviewLabels[paper.review_status]}<small>{paper.license_status === "unverified" ? "授权未核验" : paper.license_status}</small></td>
                    <td>
                      <a href={paper.landing_page_url} rel="noreferrer" target="_blank">
                        公开页面 <ArrowUpRight aria-hidden="true" size={13} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.examPapers.total > data.examPapers.items.length ? (
            <p className="governance-table-note">当前展示前 {Math.min(8, data.examPapers.items.length)} 条记录。</p>
          ) : null}
        </div> : <SectionUnavailable label="试卷内容" />}
      </section>

      <section aria-labelledby="users-governance-title" className="governance-section governance-section-split">
        <header>
          <span className="governance-section-index">03</span>
          <div>
            <h2 id="users-governance-title">账户与权限</h2>
            <p>查看学生、教师和管理员账户；教师只可查看已分配的课程和班级。</p>
          </div>
        </header>
        {data.accounts ? (
          <>
            <div className="governance-fact-grid">
              <div>
                <Users aria-hidden="true" size={19} />
                <strong>{data.summary ? `${data.summary.active_students} 名在课学生` : "在课学生暂不可用"}</strong>
                <span>来自课程成员与已有学习记录</span>
              </div>
              <div>
                <ShieldCheck aria-hidden="true" size={19} />
                <strong>{data.accounts.length} 个账户</strong>
                <span>只显示账户身份、使用状态和可执行操作</span>
              </div>
            </div>
            <AccountGovernance
              academicClasses={data.academicClasses ?? []}
              academicClassesAvailable={data.academicClasses !== null}
              accounts={data.accounts}
              onChanged={onChanged}
            />
          </>
        ) : <SectionUnavailable label="账户与班级" />}
      </section>

      <section aria-labelledby="course-governance-title" className="governance-section governance-section-split">
        <header>
          <span className="governance-section-index">04</span>
          <div>
            <h2 id="course-governance-title">课程资料与基础学情</h2>
            <p>课程资料和练习记录按课程汇总，下面只统计已经发生的学习活动。</p>
          </div>
        </header>
        {data.materials && data.summary ? (
          <>
            <div className="governance-fact-grid governance-course-facts">
              <div>
                <BookOpenText aria-hidden="true" size={19} />
                <strong>{data.materials.length} 份课程资料</strong>
                <span>{data.materials.length ? "已存材料可进入后续审核" : "当前课程尚未录入材料"}</span>
              </div>
              <div>
                <Database aria-hidden="true" size={19} />
                <strong>{data.summary.attempt_count} 次作答 · {data.summary.evidence_count} 条学习记录</strong>
                <span>{data.summary.deterministic_correct_count} 次答对，{data.summary.deterministic_incorrect_count} 次答错</span>
              </div>
            </div>
            <p className="governance-data-boundary">仅统计当前已有学习记录。</p>
          </>
        ) : <SectionUnavailable label="课程资料与学习情况" />}
      </section>
      {data.accounts && data.pilotReport ? (
        <PilotStudyGovernance accounts={data.accounts} initialReport={data.pilotReport} />
      ) : <SectionUnavailable label="试用记录" />}
    </div>
  );
}

function SectionUnavailable({ label }: { label: string }) {
  return (
    <div className="governance-section-unavailable" role="status">
      <strong>{label}暂时无法读取</strong>
      <span>其他已显示内容仍可继续使用。</span>
    </div>
  );
}

function AccountGovernance({
  academicClasses,
  academicClassesAvailable,
  accounts,
  onChanged,
}: {
  academicClasses: AcademicClassOption[];
  academicClassesAvailable: boolean;
  accounts: AuthAccount[];
  onChanged: () => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<"student" | "teacher" | "admin">("student");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null);
  const [teacherNumber, setTeacherNumber] = useState("");
  const [department, setDepartment] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const [approvalCourseId, setApprovalCourseId] = useState<(typeof DEMO_408_COURSES)[number]["id"]>(DEMO_408_COURSES[0].id);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);
  const [passwordResetSubmitting, setPasswordResetSubmitting] = useState(false);
  const createInFlightRef = useRef(false);
  const approvalInFlightRef = useRef(false);
  const resetPasswordInputRef = useRef<HTMLInputElement>(null);
  const teacherNumberInputRef = useRef<HTMLInputElement>(null);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreating(true);
    setMessage(null);
    setError(null);
    try {
      const created = await createManagedAccount({
        username,
        display_name: displayName,
        password,
        role,
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setMessage(created.account.account_status === "pending_approval"
        ? "教师账户已创建，补充教师资料和负责班级后即可启用。"
        : "账户已创建，初始密码仅应通过安全渠道交给本人。");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账户创建失败。");
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  };

  const toggle = async (account: AuthAccount) => {
    setError(null);
    try { await updateManagedAccountStatus(account.user_id, account.account_status === "active" ? "disabled" : "active"); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "账户状态更新失败。"); }
  };

  const beginPasswordReset = (account: AuthAccount) => {
    setResettingUserId(account.user_id);
    setNextPassword("");
    setPasswordConfirmation("");
    setPasswordVisible(false);
    setPasswordResetError(null);
    setMessage(null);
    setError(null);
  };

  const closePasswordReset = () => {
    if (passwordResetSubmitting) return;
    setResettingUserId(null);
    setPasswordResetError(null);
    setNextPassword("");
    setPasswordConfirmation("");
  };

  const submitPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resettingUserId) return;
    if (nextPassword !== passwordConfirmation) {
      setPasswordResetError("两次输入的密码不一致。");
      return;
    }
    if (
      nextPassword.length < 6
      || nextPassword.length > 128
      || /\s/u.test(nextPassword)
    ) {
      setPasswordResetError("密码需为 6 至 128 位，且不能含空格。");
      return;
    }
    setPasswordResetSubmitting(true);
    setPasswordResetError(null);
    setError(null);
    try {
      await resetManagedAccountPassword(resettingUserId, nextPassword);
      setResettingUserId(null);
      setNextPassword("");
      setPasswordConfirmation("");
      setMessage("密码已重置；请通过安全渠道交给本人。");
      onChanged();
    } catch (cause) {
      setPasswordResetError(cause instanceof Error ? cause.message : "密码重置失败，请稍后重试。");
    } finally {
      setPasswordResetSubmitting(false);
    }
  };

  const beginTeacherReview = (account: AuthAccount) => {
    setReviewingUserId(account.user_id);
    setTeacherNumber("");
    setDepartment("");
    setProfessionalTitle("");
    setApprovalCourseId(DEMO_408_COURSES[0].id);
    setSelectedClassIds([]);
    setMessage(null);
    setError(null);
  };

  const toggleClass = (classId: string) => {
    setSelectedClassIds((current) => (
      current.includes(classId)
        ? current.filter((item) => item !== classId)
        : [...current, classId]
    ));
  };

  const approveTeacher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewingUserId || approvalInFlightRef.current) return;
    approvalInFlightRef.current = true;
    setApprovalSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await approveManagedTeacher(reviewingUserId, {
        teacher_number: teacherNumber,
        department,
        professional_title: professionalTitle,
        course_id: approvalCourseId,
        class_ids: selectedClassIds,
      });
      setReviewingUserId(null);
      setMessage("教师账户已通过审核，可以登录教师端。");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "教师审核失败。");
    } finally {
      approvalInFlightRef.current = false;
      setApprovalSubmitting(false);
    }
  };

  const reviewingAccount = accounts.find((account) => account.user_id === reviewingUserId) ?? null;
  const resettingAccount = accounts.find((account) => account.user_id === resettingUserId) ?? null;

  useEffect(() => {
    if (resettingAccount) resetPasswordInputRef.current?.focus();
  }, [resettingAccount]);

  useEffect(() => {
    if (reviewingAccount) teacherNumberInputRef.current?.focus();
  }, [reviewingAccount]);

  return (
    <div className="account-governance-panel">
      <form aria-busy={creating} className="account-create-form" onSubmit={create}>
        <h3>创建账户</h3>
        <div className="account-create-fields">
          <input aria-label="新账户用户名" autoCapitalize="none" autoComplete="off" name="username" onChange={(event) => setUsername(event.target.value)} pattern={"[^\\p{C}\\s]{1,32}"} placeholder="例如 小谢" required spellCheck={false} value={username} />
          <input aria-label="新账户显示名称" autoComplete="off" name="display_name" onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 张同学" required value={displayName} />
          <input aria-label="新账户初始密码" autoComplete="new-password" minLength={6} name="password" onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位…" required type="password" value={password} />
          <select aria-label="新账户角色" name="role" onChange={(event) => setRole(event.target.value as "student" | "teacher" | "admin")} value={role}><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select>
          {role === "student" ? (
            <span className="account-scope-note">
              学生账户自动加入当前配置的 408 四科，用于四科起步筛查与学习计划。
            </span>
          ) : role === "teacher" ? (
            <span className="account-scope-note">
              教师账户创建后仍需审核资料、课程和班级，审核通过后才能登录。
            </span>
          ) : null}
          <button disabled={creating} type="submit">{creating ? "正在创建…" : "创建"}</button>
        </div>
      </form>
      {message ? <p className="account-auth-success" role="status">{message}</p> : null}
      {error ? <p className="account-auth-error" role="alert">{error}</p> : null}
      <div className="governance-table-wrap">
        <table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>账户类型</th><th>操作</th></tr></thead><tbody>
          {accounts.map((account) => <tr key={account.user_id}>
            <td><strong>{account.username}</strong><small>{account.display_name}</small></td>
            <td>{account.roles.map((role) => roleLabels[role]).join("、")}</td>
            <td>{account.account_status === "active" ? "启用" : account.account_status === "pending_approval" ? "待审核" : "停用"}</td>
            <td>{account.data_boundary === "legacy_demo" ? "历史演示" : "本地账户"}</td>
            <td className="account-governance-actions">
              {account.roles.includes("teacher") && account.account_status !== "active" ? (
                <button onClick={() => beginTeacherReview(account)} type="button">
                  {account.account_status === "pending_approval" ? "审核教师" : "审核并启用"}
                </button>
              ) : (
                <button onClick={() => void toggle(account)} type="button">{account.account_status === "active" ? "停用" : "启用"}</button>
              )}
              <button onClick={() => beginPasswordReset(account)} type="button">重置密码</button>
            </td>
          </tr>)}
        </tbody></table>
      </div>
      {resettingAccount ? (
        <div className="account-password-dialog-backdrop">
          <section
            aria-labelledby="account-password-dialog-title"
            aria-modal="true"
            className="account-password-dialog"
            onKeyDown={(event) => {
              if (event.key === "Escape") closePasswordReset();
            }}
            role="dialog"
          >
            <header>
              <div>
                <h3 id="account-password-dialog-title">重置 {resettingAccount.username} 的密码</h3>
                <p>设置一次性临时密码，并让账户本人登录后尽快修改。</p>
              </div>
              <button aria-label="关闭密码重置" disabled={passwordResetSubmitting} onClick={closePasswordReset} title="关闭" type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <form onSubmit={submitPasswordReset}>
              <label>
                <span>新临时密码</span>
                <div className="account-password-input">
                  <input
                    autoComplete="new-password"
                    maxLength={128}
                    minLength={6}
                    name="new-password"
                    onChange={(event) => setNextPassword(event.target.value)}
                    ref={resetPasswordInputRef}
                    required
                    type={passwordVisible ? "text" : "password"}
                    value={nextPassword}
                  />
                  <button
                    aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                    onClick={() => setPasswordVisible((current) => !current)}
                    title={passwordVisible ? "隐藏密码" : "显示密码"}
                    type="button"
                  >
                    {passwordVisible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                  </button>
                </div>
              </label>
              <label>
                <span>确认新临时密码</span>
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={6}
                  name="confirm-password"
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  required
                  type={passwordVisible ? "text" : "password"}
                  value={passwordConfirmation}
                />
              </label>
              <small>6 至 128 位，不能包含空格。</small>
              {passwordResetError ? <p className="account-auth-error" role="alert">{passwordResetError}</p> : null}
              <div className="account-password-dialog-actions">
                <button disabled={passwordResetSubmitting} onClick={closePasswordReset} type="button">取消</button>
                <button disabled={passwordResetSubmitting} type="submit">
                  {passwordResetSubmitting ? "正在重置…" : "确认重置"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {reviewingAccount ? (
        <form aria-busy={approvalSubmitting} className="teacher-approval-form" onSubmit={approveTeacher}>
          <header>
            <div>
              <h3>审核教师 · {reviewingAccount.display_name}</h3>
              <p>确认教师资料，并限定可查看的课程与班级。</p>
            </div>
            <button aria-label="关闭教师审核" disabled={approvalSubmitting} onClick={() => setReviewingUserId(null)} type="button">取消</button>
          </header>
          <div className="teacher-approval-fields">
            <label><span>教师编号</span><input autoComplete="off" disabled={approvalSubmitting} name="teacher_number" onChange={(event) => setTeacherNumber(event.target.value)} ref={teacherNumberInputRef} required value={teacherNumber} /></label>
            <label><span>院系</span><input autoComplete="off" disabled={approvalSubmitting} name="department" onChange={(event) => setDepartment(event.target.value)} required value={department} /></label>
            <label><span>职称</span><input autoComplete="off" disabled={approvalSubmitting} name="professional_title" onChange={(event) => setProfessionalTitle(event.target.value)} required value={professionalTitle} /></label>
            <label>
              <span>授权课程</span>
              <select disabled={approvalSubmitting} name="course_id" onChange={(event) => setApprovalCourseId(event.target.value as (typeof DEMO_408_COURSES)[number]["id"])} value={approvalCourseId}>
                {DEMO_408_COURSES.map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="teacher-class-options" disabled={approvalSubmitting}>
            <legend>负责班级（至少选择一个）</legend>
            {academicClasses.length === 0 ? (
              <p className="teacher-class-empty" role="status">
                {academicClassesAvailable
                  ? "暂未录入班级，需先补充班级后再审核教师。"
                  : "班级信息暂时无法读取，请重新读取后再审核教师。"}
              </p>
            ) : null}
            {academicClasses.map((academicClass) => (
              <label key={academicClass.class_id}>
                <input
                  checked={selectedClassIds.includes(academicClass.class_id)}
                  name="class_ids"
                  onChange={() => toggleClass(academicClass.class_id)}
                  type="checkbox"
                />
                <span>{academicClass.class_name}</span>
              </label>
            ))}
          </fieldset>
          <button className="teacher-approval-submit" disabled={approvalSubmitting || selectedClassIds.length === 0} type="submit">
            {approvalSubmitting ? "正在审核…" : "通过审核"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
