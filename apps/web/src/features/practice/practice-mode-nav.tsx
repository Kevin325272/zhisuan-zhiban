import type { PracticeMode } from "@xuetu/contracts";
import {
  ClipboardList,
  Crosshair,
  FileClock,
  RotateCcw,
  ScanSearch,
} from "lucide-react";
import { Link } from "react-router-dom";

interface PracticeModeNavProps {
  activeMode: PracticeMode;
  subject: string;
}

const MODES = [
  {
    mode: "diagnostic" as const,
    title: "起步筛查",
    description: "了解起点",
    icon: ScanSearch,
  },
  {
    mode: "targeted" as const,
    title: "专项练习",
    description: "逐个攻克知识点",
    icon: Crosshair,
  },
  {
    mode: "past_exam" as const,
    title: "历年真题",
    description: "按年份练习",
    icon: ClipboardList,
  },
  {
    mode: "mock_exam" as const,
    title: "限时模考",
    description: "综合题组限时作答",
    icon: FileClock,
  },
  {
    mode: "mistake_review" as const,
    title: "错题复练",
    description: "巩固易错之处",
    icon: RotateCcw,
  },
];

function modeHref(mode: PracticeMode, subject: string) {
  if (mode === "diagnostic") return "/student/onboarding";
  if (mode === "past_exam") return "/student/practice?mode=past_exam";
  const params = new URLSearchParams({ mode, subject });
  return `/student/practice?${params.toString()}`;
}

export function PracticeModeNav({ activeMode, subject }: PracticeModeNavProps) {
  return (
    <nav aria-label="训练模式" className="practice-mode-nav">
      <ol>
        {MODES.map(({ mode, title, description, icon: Icon }) => {
          const active = mode === activeMode;
          return (
            <li className={active ? "active" : ""} key={mode}>
              <Link
                aria-current={active ? "page" : undefined}
                aria-label={title}
                to={modeHref(mode, subject)}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span className="practice-mode-copy">
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
