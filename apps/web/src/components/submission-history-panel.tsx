import {
  programmingLanguageMeta,
  type ProgrammingLanguage,
  type SubmissionHistoryItem,
} from "@xuetu/contracts";
import {
  ArrowRight,
  ArrowLeftRight,
  Check,
  CircleAlert,
  GitCompareArrows,
  History,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { buildCodeDiff, type CodeDiffCell } from "../features/workbench/code-diff";
import { SyntaxHighlightedCode } from "./syntax-highlighted-code";

interface SubmissionHistoryPanelProps {
  items: SubmissionHistoryItem[];
  language: ProgrammingLanguage;
  onRestore: (item: SubmissionHistoryItem) => void;
}

export function SubmissionHistoryPanel({
  items,
  language,
  onRestore,
}: SubmissionHistoryPanelProps) {
  const languageItems = useMemo(
    () => items.filter((item) => item.code.language === language),
    [items, language],
  );
  const [baselineId, setBaselineId] = useState(languageItems.at(-1)?.submission_id ?? "");
  const [targetId, setTargetId] = useState(languageItems[0]?.submission_id ?? "");

  useEffect(() => {
    setBaselineId(languageItems.at(-1)?.submission_id ?? "");
    setTargetId(languageItems[0]?.submission_id ?? "");
  }, [languageItems]);

  const baseline =
    languageItems.find((item) => item.submission_id === baselineId) ?? languageItems.at(-1);
  const target =
    languageItems.find((item) => item.submission_id === targetId) ?? languageItems[0];
  const diff = useMemo(
    () => buildCodeDiff(baseline?.code.source ?? "", target?.code.source ?? ""),
    [baseline, target],
  );

  if (languageItems.length === 0) {
    return (
      <section className="submission-history-panel">
      <PanelHeading count={0} />
        <div className="submission-history-empty">
          <History aria-hidden="true" size={24} />
          <strong>尚无正式提交</strong>
          <span>完成一次提交评测后，这里会保留源码与结果快照。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="submission-history-panel">
      <PanelHeading count={languageItems.length} />
      <div className="submission-history-layout">
        <aside className="submission-version-rail" aria-label="历史版本">
          <div className="submission-version-rail-heading">
            <span>版本</span>
            <small>最新优先</small>
          </div>
          <ol>
            {languageItems.map((item, index) => {
              const passed = item.evaluation.passed_count === item.evaluation.total_count;
              return (
                <li key={item.submission_id}>
                  <button
                    className={target?.submission_id === item.submission_id ? "selected" : ""}
                    onClick={() => setTargetId(item.submission_id)}
                    type="button"
                  >
                    <span className={`submission-version-state ${passed ? "passed" : "failed"}`}>
                      {passed ? <Check aria-hidden="true" size={13} /> : <CircleAlert aria-hidden="true" size={13} />}
                    </span>
                    <span>
                      <strong>{versionLabel(item)}</strong>
                      <small>{formatSubmissionTime(item.created_at)}</small>
                    </span>
                    <b>{item.evaluation.passed_count}/{item.evaluation.total_count}</b>
                    {index === 0 ? <em>最新</em> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="submission-compare-workspace">
          <div className="submission-compare-toolbar">
            <label>
              <span>基线版本</span>
              <select
                aria-label="基线版本"
                name="baseline-submission"
                onChange={(event) => setBaselineId(event.target.value)}
                value={baseline?.submission_id ?? ""}
              >
                {languageItems.map((item) => (
                  <option key={item.submission_id} value={item.submission_id}>
                    {versionLabel(item)} · {item.evaluation.passed_count}/{item.evaluation.total_count}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="交换比较版本"
              disabled={!baseline || !target || languageItems.length < 2}
              onClick={() => {
                if (!baseline || !target) return;
                setBaselineId(target.submission_id);
                setTargetId(baseline.submission_id);
              }}
              title="交换比较版本"
              type="button"
            >
              <ArrowLeftRight aria-hidden="true" size={15} />
            </button>
            <label>
              <span>目标版本</span>
              <select
                aria-label="目标版本"
                name="target-submission"
                onChange={(event) => setTargetId(event.target.value)}
                value={target?.submission_id ?? ""}
              >
                {languageItems.map((item) => (
                  <option key={item.submission_id} value={item.submission_id}>
                    {versionLabel(item)} · {item.evaluation.passed_count}/{item.evaluation.total_count}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="restore-version-button"
              disabled={!target}
              onClick={() => target && onRestore(target)}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />恢复目标版本到编辑器
            </button>
          </div>

          {languageItems.length === 1 ? (
            <div className="single-submission-notice">再提交一个版本后，将显示两次源码之间的改动。</div>
          ) : null}

          <div className="code-diff-summary" aria-label="代码差异统计">
            <span className="added">新增 {diff.summary.added}</span>
            <span className="removed">删除 {diff.summary.removed}</span>
            <span className="modified">修改 {diff.summary.modified}</span>
            <span>未变 {diff.summary.unchanged}</span>
          </div>

          <div className="code-diff-scroll">
            <div aria-label="双版本代码差异" className="code-diff-table" role="table">
              <div className="code-diff-header" role="row">
                <div role="columnheader">
                  <GitCompareArrows aria-hidden="true" size={13} />
                  <strong>{baseline ? versionLabel(baseline) : "基线"}</strong>
                  <span>{baseline?.evaluation.score ?? 0} 分</span>
                </div>
                <div role="columnheader">
                  <GitCompareArrows aria-hidden="true" size={13} />
                  <strong>{target ? versionLabel(target) : "目标"}</strong>
                  <span>{target?.evaluation.score ?? 0} 分</span>
                </div>
              </div>
              <div className="code-diff-body">
                {diff.rows.map((row, index) => (
                  <div className="code-diff-row" key={`${index}-${row.left?.lineNumber ?? "gap"}-${row.right?.lineNumber ?? "gap"}`} role="row">
                    <DiffCell cell={row.left} language={language} side="left" />
                    <DiffCell cell={row.right} language={language} side="right" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div aria-label="移动端代码差异" className="code-diff-mobile">
            <div className="code-diff-mobile-heading">
              <strong>{baseline ? versionLabel(baseline) : "基线"}</strong>
              <ArrowRight aria-hidden="true" size={13} />
              <strong>{target ? versionLabel(target) : "目标"}</strong>
            </div>
            <div className="code-diff-mobile-body">
              {diff.rows.map((row, index) => (
                <MobileDiffPair
                  key={`${index}-${row.left?.lineNumber ?? "gap"}-${row.right?.lineNumber ?? "gap"}`}
                  left={row.left}
                  language={language}
                  right={row.right}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PanelHeading({ count }: { count: number }) {
  return (
    <header className="submission-history-heading">
      <div>
        <History aria-hidden="true" size={16} />
        <span>
          <h2>提交记录</h2>
          <p>正式评测留下的源码与结果快照</p>
        </span>
      </div>
      <strong>{count} 次提交</strong>
    </header>
  );
}

function DiffCell({
  cell,
  language,
  side,
}: {
  cell: CodeDiffCell | null;
  language: ProgrammingLanguage;
  side: "left" | "right";
}) {
  const sign = !cell
    ? ""
    : cell.kind === "added"
      ? "+"
      : cell.kind === "removed"
        ? "-"
        : cell.kind === "modified"
          ? "~"
          : "";
  return (
    <div className={`code-diff-cell ${cell?.kind ?? "gap"}`} data-side={side} role="cell">
      <span className="code-diff-line-number">{cell?.lineNumber ?? ""}</span>
      <span className="code-diff-sign">{sign}</span>
      <SyntaxHighlightedCode code={cell?.content || " "} language={language} />
    </div>
  );
}

function MobileDiffPair({
  left,
  language,
  right,
}: {
  left: CodeDiffCell | null;
  language: ProgrammingLanguage;
  right: CodeDiffCell | null;
}) {
  if (left?.kind === "unchanged" && right?.kind === "unchanged") {
    return <MobileDiffLine cell={right} language={language} side="same" />;
  }

  return (
    <div className="code-diff-mobile-pair">
      {left ? <MobileDiffLine cell={left} language={language} side="baseline" /> : null}
      {right ? <MobileDiffLine cell={right} language={language} side="target" /> : null}
    </div>
  );
}

function MobileDiffLine({
  cell,
  language,
  side,
}: {
  cell: CodeDiffCell;
  language: ProgrammingLanguage;
  side: "baseline" | "target" | "same";
}) {
  const sign = side === "same" ? "" : side === "baseline" ? "-" : "+";
  const versionTag = side === "same" ? "" : side === "baseline" ? "原" : "新";

  return (
    <div className={`code-diff-mobile-line ${cell.kind}`} data-side={side}>
      <span className="code-diff-version-tag">{versionTag}</span>
      <span className="code-diff-line-number">{cell.lineNumber}</span>
      <span className="code-diff-sign">{sign}</span>
      <SyntaxHighlightedCode code={cell.content || " "} language={language} />
    </div>
  );
}

function versionLabel(item: SubmissionHistoryItem) {
  return `${programmingLanguageMeta[item.code.language].label} · 版本 ${String(item.sequence).padStart(2, "0")}`;
}

function formatSubmissionTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
