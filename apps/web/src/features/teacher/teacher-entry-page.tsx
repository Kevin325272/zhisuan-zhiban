import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  FileText,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type {
  ManagedCourseEvidence,
  ManagedCourseStudentList,
  TeacherClassCreateRequest,
  TeacherClassManagement,
  TeacherInterventionAction,
  TeacherInterventionCreateRequest,
  TeacherInterventionStatus,
  TeacherInterventionTargetType,
} from "@xuetu/contracts";

import {
  ApiError,
  createTeacherClass,
  createTeacherClassInvitation,
  decideTeacherClassEnrollmentRequest,
  getAccountCourseScope,
  getManagedCourseEvidence,
  getManagedCourseStudents,
  getTeacherClassManagement,
  recordManagedTeacherIntervention,
  removeTeacherClassMember,
  revokeTeacherClassInvitation,
  updateManagedTeacherInterventionStatus,
} from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { GlobalAgentFab } from "../agent/global-agent-fab";
import { TeacherClassMembers } from "./teacher-class-members";

type CourseOption = { id: string; label: string };

function toCourseOption(course: { course_id: string; course_code: string; title: string }): CourseOption {
  return {
    id: course.course_id,
    label: course.course_code.startsWith("CS408-")
      ? `408 · ${course.title}`
      : `${course.course_code} · ${course.title}`,
  };
}

const INTERVENTION_ACTIONS: Array<{ value: TeacherInterventionAction; label: string }> = [
  { value: "assign_review", label: "安排课后复习" },
  { value: "recommend_material", label: "推荐补充材料" },
  { value: "classroom_focus", label: "下次课堂重点讲解" },
];

const INTERVENTION_STATUS_LABELS: Record<TeacherInterventionStatus, string> = {
  planned: "待送达",
  sent: "已送达",
  completed: "已完成",
  cancelled: "已取消",
};

const learningStatusLabels: Record<ManagedCourseStudentList["items"][number]["learning_status"], string> = {
  on_track: "进度正常",
  needs_attention: "需要关注",
  inactive: "近期未学习",
};

type LearningStatusFilter = "all" | ManagedCourseStudentList["items"][number]["learning_status"];

type CourseLoadErrors = Record<string, { students?: unknown; evidence?: unknown }>;
type InterventionForm = {
  action: TeacherInterventionAction;
  note: string;
  targetType: TeacherInterventionTargetType;
  targetClassId: string;
  targetStudentCode: string;
};
type ClassCreateForm = { className: string; cohortYear: string; major: string };
const STUDENTS_PER_PAGE = 15;

function createInterventionForm(): InterventionForm {
  return {
    action: "assign_review",
    note: "",
    targetType: "concept",
    targetClassId: "",
    targetStudentCode: "",
  };
}

function interventionTargetReady(form: InterventionForm) {
  if (form.targetType === "class") return Boolean(form.targetClassId);
  if (form.targetType === "student") return Boolean(form.targetStudentCode);
  return true;
}

function formatActivity(value: string | null) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEvidenceDate(value: string | null | undefined) {
  if (!value) return "暂无日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无日期";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function interventionStatusOf(status: TeacherInterventionStatus | undefined): TeacherInterventionStatus {
  return status ?? "planned";
}

function interventionTargetLabel(
  intervention: ManagedCourseEvidence["recent_interventions"][number],
) {
  if (intervention.target_type === "student") {
    return intervention.target_student_code
      ? `学生 ${intervention.target_student_code}`
      : "指定学生";
  }
  if (intervention.target_type === "class") {
    return intervention.target_class_name ?? "指定班级";
  }
  return "当前知识点";
}

function interventionNextAction(status: TeacherInterventionStatus) {
  if (status === "planned") return { status: "sent" as const, label: "标记为已送达" };
  if (status === "sent") return { status: "completed" as const, label: "标记为已完成" };
  return null;
}

function readErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "学情暂时无法读取，请检查课程授权后重试。";
}

function readClassManagementError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "班级操作没有完成，请稍后重试。";
}

export function TeacherEntryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [courseData, setCourseData] = useState<Record<string, ManagedCourseStudentList | null>>({});
  const [evidenceData, setEvidenceData] = useState<Record<string, ManagedCourseEvidence | null>>({});
  const [courseLoadErrors, setCourseLoadErrors] = useState<CourseLoadErrors>({});
  const [authorizedCourses, setAuthorizedCourses] = useState<CourseOption[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceDays, setEvidenceDays] = useState(14);
  const [requestVersion, setRequestVersion] = useState(0);
  const [interventionForms, setInterventionForms] = useState<Record<string, InterventionForm>>({});
  const [interventionBusy, setInterventionBusy] = useState<string | null>(null);
  const [interventionStatus, setInterventionStatus] = useState<string | null>(null);
  const [interventionError, setInterventionError] = useState<string | null>(null);
  const [selectedClassName, setSelectedClassName] = useState("assigned");
  const [studentStatusFilter, setStudentStatusFilter] = useState<LearningStatusFilter>("all");
  const [studentPage, setStudentPage] = useState(0);
  const [classManagementOpen, setClassManagementOpen] = useState(false);
  const [classManagement, setClassManagement] = useState<TeacherClassManagement | null>(null);
  const [classManagementCourseId, setClassManagementCourseId] = useState<string | null>(null);
  const [classManagementLoading, setClassManagementLoading] = useState(false);
  const [classManagementReloadVersion, setClassManagementReloadVersion] = useState(0);
  const [classManagementError, setClassManagementError] = useState<string | null>(null);
  const [classManagementStatus, setClassManagementStatus] = useState<string | null>(null);
  const [classManagementBusy, setClassManagementBusy] = useState<string | null>(null);
  const [generatedInviteCodes, setGeneratedInviteCodes] = useState<Record<string, string>>({});
  const [classCreateForm, setClassCreateForm] = useState<ClassCreateForm>({
    className: "",
    cohortYear: "",
    major: "",
  });
  const interventionTargetDirectoryNeeded = Object.values(interventionForms)
    .some((form) => form.targetType !== "concept");
  const classManagementNeeded = classManagementOpen || interventionTargetDirectoryNeeded;
  const loading = scopeLoading || studentsLoading || evidenceLoading;

  const loadCourses = useCallback(async () => {
    setScopeLoading(true);
    setError(null);
    setInterventionStatus(null);
    setInterventionError(null);
    try {
      const scope = await getAccountCourseScope();
      const courses = scope.items.map(toCourseOption);
      if (!courses.length) {
        throw new Error("当前教师账户没有已授权课程。");
      }
      setAuthorizedCourses(courses);
      setSelectedCourseId((current) => (
        current && courses.some((course) => course.id === current)
          ? current
          : courses[0]!.id
      ));
    } catch (cause) {
      setCourseData({});
      setEvidenceData({});
      setCourseLoadErrors({});
      setAuthorizedCourses([]);
      setSelectedCourseId(null);
      setError(readErrorMessage(cause));
    } finally {
      setScopeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses, requestVersion]);

  useEffect(() => {
    if (!selectedCourseId) return undefined;
    let cancelled = false;
    setStudentsLoading(true);
    setCourseData((current) => ({ ...current, [selectedCourseId]: null }));
    setCourseLoadErrors((current) => ({
      ...current,
      [selectedCourseId]: { ...current[selectedCourseId], students: undefined },
    }));
    void getManagedCourseStudents(selectedCourseId, {
      page: studentPage + 1,
      page_size: STUDENTS_PER_PAGE,
      class_name: selectedClassName,
      learning_status: studentStatusFilter,
    }).then((nextData) => {
      if (cancelled) return;
      setCourseData((current) => ({ ...current, [selectedCourseId]: nextData }));
    }).catch((cause) => {
      if (cancelled) return;
      setCourseLoadErrors((current) => ({
        ...current,
        [selectedCourseId]: { ...current[selectedCourseId], students: cause },
      }));
    }).finally(() => {
      if (!cancelled) setStudentsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestVersion, selectedClassName, selectedCourseId, studentPage, studentStatusFilter]);

  useEffect(() => {
    if (!selectedCourseId) return undefined;
    let cancelled = false;
    setEvidenceLoading(true);
    setEvidenceData((current) => ({ ...current, [selectedCourseId]: null }));
    setCourseLoadErrors((current) => ({
      ...current,
      [selectedCourseId]: { ...current[selectedCourseId], evidence: undefined },
    }));
    void getManagedCourseEvidence(selectedCourseId, evidenceDays === 14 ? undefined : { days: evidenceDays }).then((nextEvidence) => {
      if (cancelled) return;
      setEvidenceData((current) => ({ ...current, [selectedCourseId]: nextEvidence }));
    }).catch((cause) => {
      if (cancelled) return;
      setCourseLoadErrors((current) => ({
        ...current,
        [selectedCourseId]: { ...current[selectedCourseId], evidence: cause },
      }));
    }).finally(() => {
      if (!cancelled) setEvidenceLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestVersion, selectedCourseId, evidenceDays]);

  useEffect(() => {
    if (!classManagementNeeded || !selectedCourseId) return undefined;
    let cancelled = false;
    setClassManagementLoading(true);
    setClassManagementError(null);
    setClassManagementStatus(null);
    setClassManagement(null);
    setClassManagementCourseId(selectedCourseId);
    void getTeacherClassManagement(selectedCourseId).then((nextManagement) => {
      if (cancelled) return;
      setClassManagement(nextManagement);
    }).catch((cause) => {
      if (cancelled) return;
      setClassManagement(null);
      setClassManagementError(readClassManagementError(cause));
    }).finally(() => {
      if (!cancelled) setClassManagementLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [classManagementNeeded, classManagementReloadVersion, selectedCourseId]);

  const refreshEvidence = useCallback(async (courseId: string) => {
    const nextEvidence = await getManagedCourseEvidence(courseId, evidenceDays === 14 ? undefined : { days: evidenceDays });
    setEvidenceData((current) => ({ ...current, [courseId]: nextEvidence }));
    setCourseLoadErrors((current) => ({
      ...current,
      [courseId]: { ...current[courseId], evidence: undefined },
    }));
    return nextEvidence;
  }, [evidenceDays]);

  const updateInterventionForm = useCallback((conceptId: string, update: Partial<InterventionForm>) => {
    setInterventionForms((current) => ({
      ...current,
      [conceptId]: {
        ...(current[conceptId] ?? createInterventionForm()),
        ...update,
      },
    }));
  }, []);

  const submitIntervention = useCallback(async (conceptId: string) => {
    if (!selectedCourseId) return;
    const form = interventionForms[conceptId] ?? createInterventionForm();
    if (!form.note.trim()) {
      setInterventionError("请先写下这次干预的具体安排。");
      setInterventionStatus(null);
      return;
    }
    if (!interventionTargetReady(form)) {
      setInterventionError(form.targetType === "student" ? "请选择目标学生。" : "请选择目标班级。");
      setInterventionStatus(null);
      return;
    }
    setInterventionBusy(conceptId);
    setInterventionStatus(null);
    setInterventionError(null);
    try {
      const target: Pick<
        TeacherInterventionCreateRequest,
        "target_type" | "target_class_id" | "target_student_code"
      > = form.targetType === "class"
        ? { target_type: "class", target_class_id: form.targetClassId }
        : form.targetType === "student"
          ? { target_type: "student", target_student_code: form.targetStudentCode }
          : {};
      await recordManagedTeacherIntervention(selectedCourseId, {
        concept_id: conceptId,
        action: form.action,
        note: form.note.trim(),
        ...target,
      });
      await refreshEvidence(selectedCourseId);
      setInterventionForms((current) => ({
        ...current,
        [conceptId]: createInterventionForm(),
      }));
      setInterventionStatus("干预已记录，当前课程证据已刷新。");
    } catch (cause) {
      setInterventionError(cause instanceof ApiError ? cause.message : "干预记录失败，请稍后重试。");
    } finally {
      setInterventionBusy(null);
    }
  }, [interventionForms, refreshEvidence, selectedCourseId]);

  const updateInterventionStatus = useCallback(async (
    interventionId: string,
    nextStatus: Extract<TeacherInterventionStatus, "sent" | "completed" | "cancelled">,
  ) => {
    if (!selectedCourseId) return;
    const courseId = selectedCourseId;
    setInterventionBusy(`status:${interventionId}`);
    setInterventionStatus(null);
    setInterventionError(null);
    try {
      await updateManagedTeacherInterventionStatus(courseId, interventionId, nextStatus);
      await refreshEvidence(courseId);
      setInterventionStatus(nextStatus === "sent"
        ? "教学安排已标记为已送达，等待学生完成。"
        : nextStatus === "completed"
          ? "教学安排已完成，证据已记录。"
          : "教学安排已取消。");
    } catch (cause) {
      setInterventionError(cause instanceof ApiError ? cause.message : "教学安排状态更新失败，请稍后重试。");
    } finally {
      setInterventionBusy(null);
    }
  }, [refreshEvidence, selectedCourseId]);

  const submitClass = useCallback(async () => {
    if (!selectedCourseId) return;
    const cohortYear = Number(classCreateForm.cohortYear);
    const input: TeacherClassCreateRequest = {
      class_name: classCreateForm.className.trim(),
      cohort_year: cohortYear,
      major: classCreateForm.major.trim(),
    };
    if (!input.class_name || !input.major || !Number.isInteger(cohortYear)) {
      setClassManagementError("请完整填写班级名称、年级和专业。");
      setClassManagementStatus(null);
      return;
    }
    const courseId = selectedCourseId;
    setClassManagementBusy("create-class");
    setClassManagementError(null);
    setClassManagementStatus(null);
    try {
      const created = await createTeacherClass(courseId, input);
      setClassManagement((current) => current?.course_id === courseId
        ? { ...current, classes: [...current.classes, created] }
        : current);
      setClassCreateForm({ className: "", cohortYear: "", major: "" });
      setClassManagementStatus(`${created.class_name}已创建，现在可以生成邀请码发给学生。`);
    } catch (cause) {
      setClassManagementError(readClassManagementError(cause));
    } finally {
      setClassManagementBusy(null);
    }
  }, [classCreateForm, selectedCourseId]);

  const generateInvitation = useCallback(async (classId: string, className: string) => {
    if (!selectedCourseId) return;
    const courseId = selectedCourseId;
    const busyKey = `invite:${classId}`;
    setClassManagementBusy(busyKey);
    setClassManagementError(null);
    setClassManagementStatus(null);
    try {
      const invitation = await createTeacherClassInvitation(courseId, classId);
      setClassManagement((current) => current?.course_id === courseId ? {
        ...current,
        classes: current.classes.map((item) => item.class_id === classId ? {
          ...item,
          invitation: {
            status: "active",
            code_hint: invitation.code_hint,
            expires_at: invitation.expires_at,
          },
        } : item),
      } : current);
      setGeneratedInviteCodes((current) => ({ ...current, [classId]: invitation.invite_code }));
      setClassManagementStatus(`${className}的邀请码已生成，请发送给本班学生。`);
    } catch (cause) {
      setClassManagementError(readClassManagementError(cause));
    } finally {
      setClassManagementBusy(null);
    }
  }, [selectedCourseId]);

  const revokeInvitation = useCallback(async (classId: string, className: string) => {
    if (!selectedCourseId) return;
    const courseId = selectedCourseId;
    const busyKey = `revoke:${classId}`;
    setClassManagementBusy(busyKey);
    setClassManagementError(null);
    setClassManagementStatus(null);
    try {
      await revokeTeacherClassInvitation(courseId, classId);
      setClassManagement((current) => current?.course_id === courseId ? {
        ...current,
        classes: current.classes.map((item) => item.class_id === classId ? {
          ...item,
          invitation: { status: "none", code_hint: null, expires_at: null },
        } : item),
      } : current);
      setGeneratedInviteCodes((current) => {
        const next = { ...current };
        delete next[classId];
        return next;
      });
      setClassManagementStatus(`${className}的旧邀请码已停用。`);
    } catch (cause) {
      setClassManagementError(readClassManagementError(cause));
    } finally {
      setClassManagementBusy(null);
    }
  }, [selectedCourseId]);

  const decideEnrollment = useCallback(async (
    requestId: string,
    decision: "approved" | "rejected",
  ) => {
    if (!selectedCourseId || !classManagement) return;
    const request = classManagement.pending_requests.find((item) => item.request_id === requestId);
    if (!request) return;
    const courseId = selectedCourseId;
    const busyKey = `decision:${requestId}`;
    setClassManagementBusy(busyKey);
    setClassManagementError(null);
    setClassManagementStatus(null);
    try {
      const result = await decideTeacherClassEnrollmentRequest(
        courseId,
        request.class_id,
        request.request_id,
        { decision },
      );
      setClassManagement((current) => {
        if (!current || current.course_id !== courseId) return current;
        const alreadyMember = current.members.some((item) => item.student_code === request.student_code);
        return {
          ...current,
          classes: current.classes.map((item) => item.class_id === request.class_id ? {
            ...item,
            member_count: decision === "approved" && !alreadyMember
              ? item.member_count + 1
              : item.member_count,
            pending_request_count: Math.max(0, item.pending_request_count - 1),
          } : item),
          pending_requests: current.pending_requests.filter((item) => item.request_id !== requestId),
          members: decision === "approved" && !alreadyMember ? [...current.members, {
            class_id: request.class_id,
            class_name: request.class_name,
            student_code: request.student_code,
            display_name: request.display_name,
            student_number: request.student_number,
            joined_at: result.reviewed_at ?? new Date().toISOString(),
          }] : current.members,
        };
      });
      setClassManagementStatus(decision === "approved"
        ? `${request.display_name}已加入${request.class_name}。`
        : `${request.display_name}的入班申请已拒绝。`);
      if (decision === "approved") setRequestVersion((current) => current + 1);
    } catch (cause) {
      setClassManagementError(readClassManagementError(cause));
    } finally {
      setClassManagementBusy(null);
    }
  }, [classManagement, selectedCourseId]);

  const removeClassMember = useCallback(async (classId: string, studentCode: string) => {
    if (!selectedCourseId || !classManagement) return;
    const member = classManagement.members.find((item) => (
      item.class_id === classId && item.student_code === studentCode
    ));
    if (!member) return;
    const confirmed = window.confirm(
      `确认将${member.display_name}移出${member.class_name}吗？这只解除班级归属，不会删除学习记录、错题、画像或计划。`,
    );
    if (!confirmed) return;
    const courseId = selectedCourseId;
    const busyKey = `remove:${classId}:${studentCode}`;
    setClassManagementBusy(busyKey);
    setClassManagementError(null);
    setClassManagementStatus(null);
    try {
      await removeTeacherClassMember(courseId, classId, studentCode);
      setClassManagement((current) => current?.course_id === courseId ? {
        ...current,
        classes: current.classes.map((item) => item.class_id === classId ? {
          ...item,
          member_count: Math.max(0, item.member_count - 1),
        } : item),
        members: current.members.filter((item) => !(
          item.class_id === classId && item.student_code === studentCode
        )),
      } : current);
      setClassManagementStatus(`${member.display_name}已移出${member.class_name}，学习记录仍然保留。`);
      setRequestVersion((current) => current + 1);
    } catch (cause) {
      setClassManagementError(readClassManagementError(cause));
    } finally {
      setClassManagementBusy(null);
    }
  }, [classManagement, selectedCourseId]);

  const retry = () => setRequestVersion((current) => current + 1);
  const selectedCourse = authorizedCourses.find((course) => course.id === selectedCourseId) ?? authorizedCourses[0] ?? null;
  const data = selectedCourseId ? courseData[selectedCourseId] ?? null : null;
  const evidence = selectedCourseId ? evidenceData[selectedCourseId] ?? null : null;
  const loadErrors = selectedCourseId ? courseLoadErrors[selectedCourseId] : undefined;
  const students = data?.items ?? [];
  const teachers = data?.teachers ?? [];
  const currentTeacher = teachers.find((teacher) => teacher.display_name === auth.account?.display_name)
    ?? teachers[0]
    ?? null;
  const classOptions = data?.filters.available_classes ?? [];
  const studentPageCount = data?.pagination.total_pages ?? 0;
  const currentStudentPage = data ? Math.max(0, data.pagination.page - 1) : studentPage;
  const pagedStudents = students;
  const visibleStudentCount = data?.pagination.total_items ?? 0;
  const attentionCount = data?.summary.attention_count ?? 0;
  const averageProgress = data?.summary.average_progress_percent ?? 0;
  const averageAccuracy = data?.summary.average_accuracy_percent ?? 0;
  const classStudentCount = data?.summary.student_count ?? 0;
  const hasSelectedData = Boolean(data || evidence || loadErrors?.students || loadErrors?.evidence);
  const hasSyntheticDemoData = Boolean(
    data?.data_scope === "includes_synthetic_demo"
      || students.some((student) => student.data_provenance === "synthetic_demo")
      || teachers.some((teacher) => teacher.data_provenance === "synthetic_demo"),
  );
  const activeClassManagement = classManagementCourseId === selectedCourseId ? classManagement : null;
  const pendingEnrollmentCount = activeClassManagement?.pending_requests.length ?? 0;
  const evidenceStatus = evidence?.evidence_status
    ?? (evidence?.top_weak_concepts.length ? "sufficient" : "no_valid_evidence");

  return (
    <main className="first-release-page admin-governance-page teacher-governance-page" id="main-content">
      <header className="first-release-topbar">
        <Link className="first-release-brand" to="/teacher">
          <span aria-hidden="true"><Sparkles size={26} /></span>
          <span>
            <strong>智算智伴</strong>
            <small>教师端</small>
          </span>
        </Link>
        <div className="first-release-session-meta">
          <span><ShieldCheck aria-hidden="true" size={15} /> {auth.account?.display_name ?? "教师"}</span>
          <Link
            aria-label="退出登录"
            onClick={(event) => {
              event.preventDefault();
              void auth.logout().then(() => navigate("/login", { replace: true }));
            }}
            to="/login"
          >
            <LogOut aria-hidden="true" size={15} />
            退出
          </Link>
        </div>
      </header>

      <div className="admin-governance-layout">
        <header className="admin-governance-intro teacher-page-heading">
          <div>
            <p className="first-release-eyebrow">408 教师工作台</p>
            <div className="teacher-title-row">
              <h1>班级学情</h1>
              {hasSyntheticDemoData ? <span className="teacher-demo-badge">体验数据</span> : null}
            </div>
          </div>
          <div className="teacher-heading-actions">
            <div className="admin-course-context">
              <span>课程</span>
              {authorizedCourses.length > 1 ? (
                <select
                  aria-label="教师授权课程"
                  className="teacher-course-select"
                  disabled={Boolean(interventionBusy)}
                  onChange={(event) => {
                    setSelectedClassName("assigned");
                    setStudentStatusFilter("all");
                    setSelectedCourseId(event.target.value);
                    setStudentPage(0);
                    setInterventionForms({});
                    setInterventionStatus(null);
                    setInterventionError(null);
                    setClassManagementStatus(null);
                    setClassManagementError(null);
                    setGeneratedInviteCodes({});
                  }}
                  value={selectedCourseId ?? ""}
                >
                  {authorizedCourses.map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}
                </select>
              ) : <strong>{selectedCourse?.label ?? "正在读取授权课程"}</strong>}
            </div>
            {selectedCourseId ? (
              <button
                aria-controls="teacher-class-management"
                aria-expanded={classManagementOpen}
                className="teacher-class-management-toggle"
                onClick={() => setClassManagementOpen((current) => !current)}
                type="button"
              >
                <Users aria-hidden="true" size={17} />
                {classManagementOpen ? "收起班级管理" : "打开班级管理"}
                {classManagementOpen
                  ? <ChevronUp aria-hidden="true" size={16} />
                  : <ChevronDown aria-hidden="true" size={16} />}
              </button>
            ) : null}
          </div>
        </header>

        {loading ? (
          <section aria-live="polite" className="governance-status-line">
            <Database aria-hidden="true" size={18} />
            <span>正在读取课程学情…</span>
          </section>
        ) : null}

        {error ? (
          <section className="governance-error" role="alert">
            <div>
              <strong>暂时无法读取课程学情</strong>
              <p>{error}</p>
            </div>
            <button onClick={retry} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              重新读取
            </button>
          </section>
        ) : null}

        {hasSelectedData ? (
          <div className="governance-ledger">
            {currentTeacher ? (
              <section aria-label="任课教师" className="teacher-profile-summary">
                <span className="teacher-profile-avatar" aria-hidden="true">{currentTeacher.display_name.slice(0, 1)}</span>
                <div className="teacher-profile-name">
                  <span>任课教师</span>
                  <strong>{currentTeacher.display_name}</strong>
                  <small>{currentTeacher.professional_title} · {currentTeacher.department}</small>
                </div>
                <dl>
                  <div><dt>教师编号</dt><dd>{currentTeacher.teacher_number}</dd></div>
                  <div className="teacher-assigned-classes">
                    <dt>负责班级</dt>
                    <dd><details>
                      <summary>{currentTeacher.assigned_classes.length} 个教学班 <ChevronDown aria-hidden="true" size={15} /></summary>
                      <div className="teacher-class-tags">
                        {currentTeacher.assigned_classes.map(className => <span key={className}>{className}</span>)}
                      </div>
                    </details></dd>
                  </div>
                </dl>
              </section>
            ) : null}

            <section aria-label="班级概览" className="teacher-class-overview">
              <article>
                <Users aria-hidden="true" size={19} />
                <span>学生人数</span>
                <strong>{classStudentCount}</strong>
              </article>
              <article data-tone={attentionCount > 0 ? "attention" : "steady"}>
                <AlertTriangle aria-hidden="true" size={19} />
                <span>需要关注</span>
                <strong>{attentionCount}</strong>
              </article>
              <article>
                <BarChart3 aria-hidden="true" size={19} />
                <span>平均进度</span>
                <strong>{averageProgress}%</strong>
              </article>
              <article>
                <CheckCircle2 aria-hidden="true" size={19} />
                <span>平均正确率</span>
                <strong>{averageAccuracy}%</strong>
              </article>
            </section>

            {classManagementOpen ? (
              <section
                aria-label="班级管理"
                className="governance-section teacher-class-management-section"
                id="teacher-class-management"
              >
                <header>
                  <span className="governance-section-index"><Users aria-hidden="true" size={16} /></span>
                  <div>
                    <h2>班级管理</h2>
                  </div>
                  {activeClassManagement ? (
                    <div className="governance-totals">
                      <strong>{activeClassManagement.classes.length} 个班级</strong>
                      <span>{pendingEnrollmentCount} 项待确认</span>
                    </div>
                  ) : null}
                </header>

                {classManagementLoading ? (
                  <p aria-live="polite" className="teacher-class-management-message">
                    <Database aria-hidden="true" size={16} /> 正在读取班级名单…
                  </p>
                ) : null}
                {classManagementError ? (
                  <div className="teacher-class-management-error" role="alert">
                    <span>{classManagementError}</span>
                    {!activeClassManagement ? (
                      <button
                        aria-label="重新读取班级"
                        onClick={() => setClassManagementReloadVersion((current) => current + 1)}
                        type="button"
                      >
                        <RefreshCw aria-hidden="true" size={15} />
                        重新读取
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {classManagementStatus ? (
                  <p className="teacher-class-management-status" role="status">{classManagementStatus}</p>
                ) : null}

                {activeClassManagement ? (
                  <>
                    <form
                      className="teacher-class-create-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitClass();
                      }}
                    >
                      <div className="teacher-class-create-heading">
                        <Plus aria-hidden="true" size={17} />
                        <div><strong>新建班级</strong><span>用于收集本班学生的学习进度</span></div>
                      </div>
                      <label>
                        <span>班级名称</span>
                        <input
                          disabled={classManagementBusy === "create-class"}
                          maxLength={100}
                          onChange={(event) => setClassCreateForm((current) => ({ ...current, className: event.target.value }))}
                          placeholder="例如：计算机科学与技术2401班"
                          required
                          value={classCreateForm.className}
                        />
                      </label>
                      <label>
                        <span>年级</span>
                        <input
                          disabled={classManagementBusy === "create-class"}
                          inputMode="numeric"
                          max={2100}
                          min={2000}
                          onChange={(event) => setClassCreateForm((current) => ({ ...current, cohortYear: event.target.value }))}
                          placeholder="2024"
                          required
                          type="number"
                          value={classCreateForm.cohortYear}
                        />
                      </label>
                      <label>
                        <span>专业</span>
                        <input
                          disabled={classManagementBusy === "create-class"}
                          maxLength={100}
                          onChange={(event) => setClassCreateForm((current) => ({ ...current, major: event.target.value }))}
                          placeholder="计算机科学与技术"
                          required
                          value={classCreateForm.major}
                        />
                      </label>
                      <button disabled={classManagementBusy === "create-class"} type="submit">
                        <Plus aria-hidden="true" size={16} />
                        {classManagementBusy === "create-class" ? "正在创建…" : "创建班级"}
                      </button>
                    </form>

                    <div className="teacher-class-management-block">
                      <div className="teacher-class-management-block-title">
                        <KeyRound aria-hidden="true" size={17} />
                        <div><h3>班级与邀请码</h3></div>
                      </div>
                      {activeClassManagement.classes.length ? (
                        <div className="governance-table-wrap teacher-class-management-table-wrap">
                          <table className="teacher-class-directory-table">
                            <caption className="visually-hidden">教师负责的班级与邀请码</caption>
                            <thead><tr><th scope="col">班级</th><th scope="col">学生</th><th scope="col">待确认</th><th scope="col">邀请码</th><th scope="col">操作</th></tr></thead>
                            <tbody>
                              {activeClassManagement.classes.map((item) => {
                                const rawCode = generatedInviteCodes[item.class_id];
                                const inviteBusy = classManagementBusy === `invite:${item.class_id}`
                                  || classManagementBusy === `revoke:${item.class_id}`;
                                return (
                                  <tr key={item.class_id}>
                                    <td><strong>{item.class_name}</strong><small>{item.cohort_year} 级 · {item.major}</small></td>
                                    <td>{item.member_count} 人</td>
                                    <td>{item.pending_request_count} 人</td>
                                    <td className="teacher-invitation-cell">
                                      {rawCode ? <><code>{rawCode}</code><small>仅本次显示</small></> : item.invitation.status === "active"
                                        ? <><code>{item.invitation.code_hint}</code><small>有效至 {formatActivity(item.invitation.expires_at)}</small></>
                                        : <span>未启用</span>}
                                    </td>
                                    <td>
                                      {item.invitation.status === "active" ? (
                                        <button
                                          aria-label={`停用邀请码：${item.class_name}`}
                                          className="teacher-class-action danger"
                                          disabled={inviteBusy}
                                          onClick={() => void revokeInvitation(item.class_id, item.class_name)}
                                          type="button"
                                        >
                                          <XCircle aria-hidden="true" size={15} /> 停用
                                        </button>
                                      ) : (
                                        <button
                                          aria-label={`生成邀请码：${item.class_name}`}
                                          className="teacher-class-action"
                                          disabled={inviteBusy}
                                          onClick={() => void generateInvitation(item.class_id, item.class_name)}
                                          type="button"
                                        >
                                          <KeyRound aria-hidden="true" size={15} /> 生成
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="teacher-class-management-empty">还没有班级，请先创建一个班级。</p>}
                    </div>

                    <div className="teacher-class-management-block">
                      <div className="teacher-class-management-block-title">
                        <UserPlus aria-hidden="true" size={17} />
                        <div><h3>待确认申请</h3></div>
                      </div>
                      {activeClassManagement.pending_requests.length ? (
                        <div className="governance-table-wrap teacher-class-management-table-wrap">
                          <table className="teacher-class-request-table">
                            <caption className="visually-hidden">等待教师确认的入班申请</caption>
                            <thead><tr><th scope="col">学生</th><th scope="col">申请班级</th><th scope="col">提交时间</th><th scope="col">操作</th></tr></thead>
                            <tbody>
                              {activeClassManagement.pending_requests.map((item) => {
                                const busy = classManagementBusy === `decision:${item.request_id}`;
                                return (
                                  <tr key={item.request_id}>
                                    <td><strong>{item.display_name}</strong><small>{item.student_number}</small></td>
                                    <td>{item.class_name}</td>
                                    <td>{formatActivity(item.submitted_at)}</td>
                                    <td><div className="teacher-class-row-actions">
                                      <button
                                        aria-label={`批准：${item.display_name}`}
                                        disabled={busy}
                                        onClick={() => void decideEnrollment(item.request_id, "approved")}
                                        type="button"
                                      ><CheckCircle2 aria-hidden="true" size={15} /> 批准</button>
                                      <button
                                        aria-label={`拒绝：${item.display_name}`}
                                        className="danger"
                                        disabled={busy}
                                        onClick={() => void decideEnrollment(item.request_id, "rejected")}
                                        type="button"
                                      ><XCircle aria-hidden="true" size={15} /> 拒绝</button>
                                    </div></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="teacher-class-management-empty">当前没有等待确认的申请。</p>}
                    </div>

                    <div className="teacher-class-management-block">
                      <div className="teacher-class-management-block-title">
                        <Users aria-hidden="true" size={17} />
                        <div><h3>班级成员</h3></div>
                      </div>
                      {activeClassManagement.members.length ? (
                        <TeacherClassMembers key={selectedCourseId} members={activeClassManagement.members}
                          busyKey={classManagementBusy}
                          onRemove={(classId, studentCode) => void removeClassMember(classId, studentCode)} />
                      ) : <p className="teacher-class-management-empty">班级里还没有已确认的学生。</p>}
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}

            <section aria-labelledby="teacher-overview-title" className="governance-section teacher-roster-section">
              <header>
                <span className="governance-section-index"><Users aria-hidden="true" size={16} /></span>
                <div>
                  <h2 id="teacher-overview-title">学生学习进度</h2>
                </div>
                <div className="governance-totals">
                  <strong>{visibleStudentCount} 名学生</strong>
                </div>
              </header>

              <div className="teacher-roster-filters">
                <label>
                  <span>班级</span>
                  <select
                    aria-label="选择班级"
                    onChange={(event) => {
                      setSelectedClassName(event.target.value);
                      setStudentPage(0);
                    }}
                    value={selectedClassName}
                  >
                    <option value="assigned">全部已分班学生</option>
                    <option value="all">所有课程成员</option>
                    {classOptions.map((className) => <option key={className} value={className}>{className}</option>)}
                  </select>
                </label>
                <div aria-label="按学习状态筛选" className="teacher-status-filter" role="group">
                  {([
                    ["all", "全部"],
                    ["needs_attention", "需要关注"],
                    ["inactive", "近期未学习"],
                    ["on_track", "进度正常"],
                  ] as const).map(([value, label]) => (
                    <button
                      aria-pressed={studentStatusFilter === value}
                      key={value}
                      onClick={() => {
                        setStudentStatusFilter(value);
                        setStudentPage(0);
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {loadErrors?.students ? <p className="teacher-empty-state" role="alert">学生明细暂时不可用：{readErrorMessage(loadErrors.students)}</p> : (
                <>
                  <div className="governance-table-wrap">
                    <table className="teacher-student-table">
                      <caption className="visually-hidden">班级学生学习进度</caption>
                      <thead>
                        <tr>
                          <th scope="col">学生</th>
                          <th scope="col">年级与班级</th>
                          <th scope="col">学习状态</th>
                          <th scope="col">当前进度</th>
                          <th scope="col">正确率</th>
                          <th scope="col">近7天作答</th>
                          <th scope="col">学习动态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedStudents.map((student) => (
                          <tr key={student.student_code}>
                            <td className="teacher-student-identity"><strong>{student.display_name}</strong><small>{student.student_number}</small></td>
                            <td><strong>{student.cohort_year ? `${student.cohort_year} 级` : "年级待补充"}</strong><small>{student.class_name ?? student.major ?? "班级待补充"}</small></td>
                            <td><span className="teacher-status-chip" data-status={student.learning_status}>{learningStatusLabels[student.learning_status]}</span></td>
                            <td>
                              <div className="teacher-progress-cell">
                                <div
                                  aria-label={`${student.display_name}课程进度 ${student.plan_completion_percent}%`}
                                  aria-valuemax={100}
                                  aria-valuemin={0}
                                  aria-valuenow={student.plan_completion_percent}
                                  className="teacher-progress-track"
                                  role="progressbar"
                                ><i style={{ width: `${student.plan_completion_percent}%` }} /></div>
                                <strong>{student.plan_completion_percent}%</strong>
                              </div>
                            </td>
                            <td><strong>{student.accuracy_percent}%</strong><small>{student.correct_count} 对 · {student.incorrect_count} 错</small></td>
                            <td><strong>{student.recent_attempt_count ?? 0} 次</strong><small>累计 {student.evidence_count} 条记录</small></td>
                            <td className="teacher-learning-activity">
                              <strong>{student.current_focus ?? "暂无课程学习记录"}</strong>
                              {student.last_active_at ? <small>
                                <span>{({ reading: "最近阅读", practice: "最近练习", experiment: "实验记录", probe: "学习诊断", demo_snapshot: "体验场景", none: "学习记录" } as const)[student.focus_source ?? "none"]}</span>
                                <time dateTime={student.last_active_at}>{formatActivity(student.last_active_at)}</time>
                              </small> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {studentPageCount > 1 ? (
                    <nav aria-label="学生名单分页" className="teacher-roster-pagination">
                      <span>第 {currentStudentPage + 1} / {studentPageCount} 页</span>
                      <div>
                        <button
                          aria-label="上一页"
                          disabled={currentStudentPage === 0}
                          onClick={() => setStudentPage((current) => Math.max(0, current - 1))}
                          title="上一页"
                          type="button"
                        >
                          <ChevronLeft aria-hidden="true" size={17} />
                        </button>
                        <button
                          aria-label="下一页"
                          disabled={currentStudentPage >= studentPageCount - 1}
                          onClick={() => setStudentPage((current) => Math.min(studentPageCount - 1, current + 1))}
                          title="下一页"
                          type="button"
                        >
                          <ChevronRight aria-hidden="true" size={17} />
                        </button>
                      </div>
                    </nav>
                  ) : null}
                </>
              )}
              {!students.length && !studentsLoading && !loadErrors?.students ? <p className="teacher-empty-state">当前筛选下没有学生。</p> : null}
            </section>

            <section aria-labelledby="teacher-weak-title" className="governance-section teacher-weak-section">
              <header>
                <span className="governance-section-index"><FileText aria-hidden="true" size={16} /></span>
                  <div>
                    <h2 id="teacher-weak-title">共性薄弱点</h2>
                </div>
                <div className="teacher-insight-period">
                  <span>当前课程</span>
                  <select aria-label="薄弱点统计时间" value={evidenceDays} disabled={Boolean(interventionBusy)}
                    onChange={event => setEvidenceDays(Number(event.target.value))}>
                    <option value={14}>近 14 天</option>
                    <option value={30}>近 30 天</option>
                    <option value={90}>近 90 天</option>
                  </select>
                  {evidence?.window ? <time>{formatEvidenceDate(evidence.window.start_at)} — {formatEvidenceDate(evidence.window.end_at)}</time> : null}
                </div>
              </header>

              {evidenceLoading ? <p className="teacher-empty-state" role="status">正在更新薄弱点…</p> : loadErrors?.evidence ? (
                <p className="teacher-empty-state" role="alert">薄弱点暂时不可用：{readErrorMessage(loadErrors.evidence)}</p>
              ) : evidence?.top_weak_concepts.length ? (
                <>
                  {interventionTargetDirectoryNeeded && !classManagementOpen && classManagementLoading ? (
                    <p aria-live="polite" className="teacher-class-management-message">
                      <Database aria-hidden="true" size={16} /> 正在读取可选班级与学生…
                    </p>
                  ) : null}
                  {interventionTargetDirectoryNeeded && !classManagementOpen && classManagementError ? (
                    <div className="teacher-class-management-error" role="alert">
                      <span>{classManagementError}</span>
                      <button
                        aria-label="重新读取干预目标"
                        onClick={() => setClassManagementReloadVersion((current) => current + 1)}
                        type="button"
                      >
                        <RefreshCw aria-hidden="true" size={14} /> 重试
                      </button>
                    </div>
                  ) : null}
                  <div className="teacher-weak-grid">
                    {evidence.top_weak_concepts.map((concept) => {
                      const form = interventionForms[concept.concept_id] ?? createInterventionForm();
                      const busy = interventionBusy === concept.concept_id;
                      const targetReady = interventionTargetReady(form);
                      const targetMembers = activeClassManagement?.members.filter((member) => (
                        member.class_id === form.targetClassId
                      )) ?? [];
                      return (
                        <article className="teacher-weak-card" key={concept.concept_id}>
                        <div className="teacher-weak-card-heading">
                          <div>
                            <span className="teacher-weak-kicker">优先讲解</span>
                            <h3>{concept.concept_title}</h3>
                          </div>
                        </div>
                        <div className="teacher-weak-metrics" aria-label={`${concept.concept_title} 学情指标`}>
                          <span><strong>{concept.incorrect_count}</strong> 次错误</span>
                          <span><strong>{concept.pending_review_count}</strong> 条待审核</span>
                          <span><strong>{concept.student_count}</strong> 名作答学生</span>
                        </div>
                        <p className="teacher-weak-last-active">最近活动：{formatActivity(concept.last_activity_at)}</p>
                          <form className="teacher-intervention-form" onSubmit={(event) => { event.preventDefault(); void submitIntervention(concept.concept_id); }}>
                            <strong className="teacher-intervention-heading">教学安排</strong>
                            <label>
                              <span>干预范围</span>
                              <select
                                aria-label={`干预范围：${concept.concept_title}`}
                                disabled={busy}
                                onChange={(event) => updateInterventionForm(concept.concept_id, {
                                  targetType: event.target.value as TeacherInterventionTargetType,
                                  targetClassId: "",
                                  targetStudentCode: "",
                                })}
                                value={form.targetType}
                              >
                                <option value="concept">当前知识点</option>
                                <option value="class">指定班级</option>
                                <option value="student">指定学生</option>
                              </select>
                            </label>
                            {form.targetType !== "concept" && activeClassManagement ? (
                              <label>
                                <span>目标班级</span>
                                <select
                                  aria-label={`目标班级：${concept.concept_title}`}
                                  disabled={busy}
                                  onChange={(event) => updateInterventionForm(concept.concept_id, {
                                    targetClassId: event.target.value,
                                    targetStudentCode: "",
                                  })}
                                  value={form.targetClassId}
                                >
                                  <option value="">请选择班级</option>
                                  {activeClassManagement.classes.map((item) => (
                                    <option key={item.class_id} value={item.class_id}>{item.class_name}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {form.targetType === "student" && activeClassManagement ? (
                              <label>
                                <span>目标学生</span>
                                <select
                                  aria-label={`目标学生：${concept.concept_title}`}
                                  disabled={busy || !form.targetClassId}
                                  onChange={(event) => updateInterventionForm(concept.concept_id, {
                                    targetStudentCode: event.target.value,
                                  })}
                                  value={form.targetStudentCode}
                                >
                                  <option value="">请选择学生</option>
                                  {targetMembers.map((member) => (
                                    <option key={member.student_code} value={member.student_code}>
                                      {member.display_name} · {member.student_number}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                          <label>
                            <span>下一步动作</span>
                            <select
                              aria-label={`干预动作：${concept.concept_title}`}
                              disabled={busy}
                              onChange={(event) => updateInterventionForm(concept.concept_id, { action: event.target.value as TeacherInterventionAction })}
                              value={form.action}
                            >
                              {INTERVENTION_ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>具体安排</span>
                            <textarea
                              aria-label={`干预备注：${concept.concept_title}`}
                              disabled={busy}
                              maxLength={500}
                              onChange={(event) => updateInterventionForm(concept.concept_id, { note: event.target.value })}
                              placeholder="例如：下次课先复习队列判空条件，再安排一道迁移题。"
                              rows={3}
                              value={form.note}
                            />
                          </label>
                            <button disabled={busy || !form.note.trim() || !targetReady} type="submit">
                            {busy ? "正在记录…" : `记录干预：${concept.concept_title}`}
                          </button>
                          </form>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="teacher-insight-empty">
                  <span className="teacher-insight-icon"><BookOpenCheck aria-hidden="true" size={25} /></span>
                  <strong>{evidenceStatus === "insufficient_sample" ? "还需要更多作答记录"
                    : evidenceStatus === "no_valid_evidence" ? "这段时间暂无可分析的作答" : "暂未发现集中的共性薄弱点"}</strong>
                  <a href="#teacher-overview-title">查看学生进度 <ChevronRight aria-hidden="true" size={16} /></a>
                </div>
              )}
              {interventionStatus ? <p className="teacher-intervention-status" role="status">{interventionStatus}</p> : null}
              {interventionError ? <p className="teacher-intervention-error" role="alert">{interventionError}</p> : null}
              {evidence?.recent_interventions.length ? (
                <div className="teacher-intervention-history">
                  <h3>最近教学安排</h3>
                  <ul>
                    {evidence.recent_interventions.map((item) => {
                      const currentStatus = interventionStatusOf(item.status);
                      const nextAction = interventionNextAction(currentStatus);
                      const canCancel = currentStatus === "planned" || currentStatus === "sent";
                      const statusBusy = interventionBusy === `status:${item.intervention_id}`;
                      return (
                        <li data-status={currentStatus} key={item.intervention_id}>
                          <div className="teacher-intervention-record">
                            <div className="teacher-intervention-record-title">
                              <strong>{item.concept_title}</strong>
                              <span className="teacher-intervention-state" data-status={currentStatus}>
                                {INTERVENTION_STATUS_LABELS[currentStatus]}
                              </span>
                            </div>
                            <p>{item.note}</p>
                            <div className="teacher-intervention-record-meta">
                              <span>{INTERVENTION_ACTIONS.find((action) => action.value === item.action)?.label ?? item.action}</span>
                              <span>{`范围：${interventionTargetLabel(item)}`}</span>
                              <time dateTime={item.created_at}>{formatActivity(item.created_at)}</time>
                            </div>
                          </div>
                          {nextAction || canCancel ? (
                            <div className="teacher-intervention-actions">
                              {nextAction ? (
                                <button
                                  aria-label={`${nextAction.label}：${item.concept_title}`}
                                  className="teacher-intervention-advance"
                                  disabled={statusBusy}
                                  onClick={() => void updateInterventionStatus(item.intervention_id, nextAction.status)}
                                  type="button"
                                >
                                  {nextAction.status === "sent"
                                    ? <Send aria-hidden="true" size={15} />
                                    : <CheckCircle2 aria-hidden="true" size={15} />}
                                  {statusBusy ? "正在更新…" : nextAction.label}
                                </button>
                              ) : null}
                              {canCancel ? (
                                <button
                                  aria-label={`取消教学安排：${item.concept_title}`}
                                  className="teacher-intervention-cancel"
                                  disabled={statusBusy}
                                  onClick={() => void updateInterventionStatus(item.intervention_id, "cancelled")}
                                  type="button"
                                >
                                  <XCircle aria-hidden="true" size={15} />
                                  取消
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
      <GlobalAgentFab />
    </main>
  );
}
