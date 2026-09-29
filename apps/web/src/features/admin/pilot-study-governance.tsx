import type {
  AuthAccount,
  PilotManagementReport,
  PilotParticipantEnrollment,
} from "@xuetu/contracts";
import {
  FileJson,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import {
  ApiError,
  downloadPilotReport,
  enrollPilotParticipant,
  getPilotManagementReport,
} from "../../api/client";

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "试用记录暂时无法更新，请稍后重试。";
}

function metric(value: number | null, suffix = "") {
  return value === null ? "暂无" : `${value}${suffix}`;
}

function signedMetric(value: number | null) {
  if (value === null) return "暂无";
  return `${value > 0 ? "+" : ""}${value}`;
}

function participantKindLabel(kind: "real_trial" | "synthetic_verification") {
  return kind === "real_trial" ? "试用学生" : "演示账户";
}

export function PilotStudyGovernance({
  accounts,
  initialReport,
}: {
  accounts: AuthAccount[];
  initialReport: PilotManagementReport;
}) {
  const eligibleAccounts = useMemo(
    () => accounts.filter((account) =>
      account.account_status === "active"
      && account.roles.includes("student")
      && !account.roles.includes("admin")),
    [accounts],
  );
  const [report, setReport] = useState(initialReport);
  const [username, setUsername] = useState(eligibleAccounts[0]?.username ?? "");
  const [participantCode, setParticipantCode] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [participantKind, setParticipantKind] = useState<
    PilotParticipantEnrollment["participant_kind"]
  >("real_trial");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshReport = async () => {
    const updated = await getPilotManagementReport(true);
    setReport(updated);
    return updated;
  };

  const enroll = async (event: FormEvent) => {
    event.preventDefault();
    if (!username || !participantCode.trim() || !roleLabel.trim()) return;
    setBusy("enroll");
    setError(null);
    setMessage(null);
    try {
      await enrollPilotParticipant({
        username,
        participant_code: participantCode.trim().toUpperCase(),
        role_label: roleLabel.trim(),
        participant_kind: participantKind,
      });
      await refreshReport();
      setParticipantCode("");
      setMessage("参与者已登记，试用报告已刷新。");
    } catch (enrollmentError) {
      setError(readableError(enrollmentError));
    } finally {
      setBusy(null);
    }
  };

  const download = async (format: "json" | "csv") => {
    setBusy(`download-${format}`);
    setError(null);
    try {
      await downloadPilotReport(format, false);
    } catch (downloadError) {
      setError(readableError(downloadError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="pilot-governance-title" className="governance-section pilot-governance-section">
      <header>
        <span className="governance-section-index">05</span>
        <div>
          <h2 id="pilot-governance-title">真实试用验证</h2>
          <p>登记参与学生，汇总任务完成情况与使用反馈。</p>
        </div>
        <div className="pilot-governance-actions">
          <button onClick={() => void download("json")} type="button">
            <FileJson aria-hidden="true" size={15} />下载 JSON
          </button>
          <button onClick={() => void download("csv")} type="button">
            <FileSpreadsheet aria-hidden="true" size={15} />下载 CSV
          </button>
        </div>
      </header>

      <div className="pilot-governance-scope" aria-label="试用概况">
        <div>
          <strong>{report.summary.real_participants} 名试用学生</strong>
          <span>{report.summary.completed_real_participants} 名已完成任务</span>
        </div>
        <div>
          <strong>{report.summary.synthetic_participants} 个演示账户</strong>
          <span>供现场体验使用</span>
        </div>
        <p><ShieldCheck aria-hidden="true" size={15} />小样本观察，不作统计显著性结论</p>
      </div>

      <div className="pilot-governance-metrics" aria-label="试用观察指标">
        <span>基线正确率 {metric(report.summary.baseline_correct_rate, "%")}</span>
        <span>迁移正确率 {metric(report.summary.transfer_correct_rate, "%")}</span>
        <span>观察变化 {signedMetric(report.summary.observed_change_percentage_points)} 个百分点</span>
        <span>平均完成 {metric(report.summary.average_completion_minutes, " 分钟")}</span>
        <span>平均易用性 {metric(report.summary.average_ease_of_use, " / 5")}</span>
        <span>平均讲解帮助 {metric(report.summary.average_guidance_helpfulness, " / 5")}</span>
      </div>

      <form className="pilot-enrollment-form" onSubmit={enroll}>
        <div className="pilot-enrollment-heading">
          <UserPlus aria-hidden="true" size={18} />
          <div>
            <strong>登记已有学生账户</strong>
            <span>选择需要登记的学生账户。</span>
          </div>
        </div>
        <label>
          学生账户
          <select aria-label="学生账户" onChange={(event) => setUsername(event.target.value)} required value={username}>
            {eligibleAccounts.length === 0 ? <option value="">没有可登记的启用学生账户</option> : null}
            {eligibleAccounts.map((account) => (
              <option key={account.user_id} value={account.username}>
                {account.username} · {account.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          匿名编号
          <input aria-label="匿名编号" maxLength={16} onChange={(event) => setParticipantCode(event.target.value)} placeholder="如 P001" required value={participantCode} />
        </label>
        <label>
          身份角色标签
          <input aria-label="身份角色标签" maxLength={100} onChange={(event) => setRoleLabel(event.target.value)} placeholder="如 2023级计算机专业学生" required value={roleLabel} />
        </label>
        <label>
          参与类型
          <select aria-label="参与类型" onChange={(event) => setParticipantKind(event.target.value as PilotParticipantEnrollment["participant_kind"])} value={participantKind}>
            <option value="real_trial">试用学生</option>
            <option value="synthetic_verification">演示账户</option>
          </select>
        </label>
        <button disabled={busy === "enroll" || eligibleAccounts.length === 0} type="submit">
          {busy === "enroll" ? <RefreshCw aria-hidden="true" size={15} /> : <UserPlus aria-hidden="true" size={15} />}
          {busy === "enroll" ? "正在登记" : "登记参与者"}
        </button>
      </form>

      {error ? <p className="pilot-governance-message error" role="alert">{error}</p> : null}
      {message ? <p className="pilot-governance-message" role="status">{message}</p> : null}

      {report.summary.real_participants === 0 ? (
        <div className="pilot-governance-empty">
          <strong>尚无试用记录</strong>
          <span>登记学生并完成三阶段任务后，这里才显示观察指标。</span>
        </div>
      ) : null}

      {report.participants.length > 0 ? (
        <div className="governance-table-wrap pilot-report-table-wrap">
          <table aria-label="匿名试用记录">
            <thead>
              <tr>
                <th scope="col">匿名编号</th>
                <th scope="col">身份标签</th>
                <th scope="col">类别</th>
                <th scope="col">知情同意</th>
                <th scope="col">任务状态</th>
                <th scope="col">反馈</th>
              </tr>
            </thead>
            <tbody>
              {report.participants.map((participant) => (
                <tr key={participant.participant_code}>
                  <td><strong>{participant.participant_code}</strong></td>
                  <td>{participant.role_label}</td>
                  <td>{participantKindLabel(participant.participant_kind)}</td>
                  <td>{participant.consented_at ? "已同意" : "未同意"}</td>
                  <td>{participant.completed_at ? "三项完成" : `${participant.tasks.filter((task) => task.completed_at).length} / ${participant.tasks.length}`}</td>
                  <td>{participant.feedback ? "已提交" : "待提交"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

    </section>
  );
}
