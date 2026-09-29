import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  FileText,
  Network,
  RotateCcw,
  ShieldCheck,
  Target,
  ThumbsDown,
  ThumbsUp,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  loadLearningOutputs,
  saveReviewFeedback,
  type GeneratedReviewCard,
  type ReviewFeedback,
  type ReviewRating,
} from "../../lib/learning-output-store";

interface ReviewTask {
  title: string;
  course: string;
  minutes: number;
  reason: string;
  icon: LucideIcon;
  href: string;
  scheduledFor?: string;
}

const reviewTasksByMonth: Record<string, Record<number, ReviewTask[]>> = {
  "2026-6": {
    30: [
      { title: "图遍历先修知识预热", course: "数据结构", minutes: 12, reason: "新知识学习前的基础召回", icon: Network, href: "/student/courses/data-structures" },
    ],
  },
  "2026-7": {
    23: [
    { title: "队列基础快速回忆", course: "数据结构", minutes: 6, reason: "BFS 前置知识 · 间隔 3 天", icon: RotateCcw, href: "/student/plan" },
    { title: "BFS 重复入队错因复盘", course: "数据结构", minutes: 14, reason: "昨日出现 2 次同类错误", icon: Code2, href: "/student/tasks/task_bfs_bug_001" },
    { title: "Cache 地址映射抽查", course: "计算机组成原理", minutes: 18, reason: "掌握度稳定性验证", icon: ShieldCheck, href: "/student/practice" },
    ],
    24: [
    { title: "邻接表复杂度辨析", course: "数据结构", minutes: 10, reason: "概念易混淆", icon: Network, href: "/student/courses/data-structures" },
    ],
    25: [
    { title: "BFS 边界用例复核", course: "数据结构", minutes: 12, reason: "空图与重复边专项回访", icon: Target, href: "/student/tasks/task_bfs_bug_001" },
    { title: "进程状态转换回忆", course: "操作系统", minutes: 8, reason: "首次间隔复习", icon: RotateCcw, href: "/student/courses" },
    ],
    27: [
    { title: "DFS / BFS 策略对照", course: "数据结构", minutes: 15, reason: "跨概念迁移", icon: Network, href: "/student/courses/data-structures" },
    ],
    30: [
    { title: "BFS 独立迁移验证", course: "数据结构", minutes: 20, reason: "7 天后稳定性检查", icon: ShieldCheck, href: "/student/practice" },
    ],
  },
  "2026-8": {
    3: [
      { title: "BFS 稳定性回访", course: "数据结构", minutes: 15, reason: "独立验证后第 10 天回访", icon: ShieldCheck, href: "/student/tasks/task_bfs_bug_001" },
    ],
    7: [
      { title: "图遍历综合迁移", course: "数据结构", minutes: 22, reason: "从遍历策略迁移到最短路问题", icon: Target, href: "/student/practice" },
    ],
  },
};

interface CalendarCell {
  key: string;
  day: number;
  month: number;
  year: number;
  position: "prev" | "current" | "next";
}

function monthKey(year: number, month: number) {
  return `${year}-${month}`;
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatShortDate(value: string) {
  const [, month = "--", day = "--"] = value.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

const reviewRatingMeta: Record<ReviewRating, { label: string; days: number }> = {
  mastered: { label: "掌握", days: 7 },
  fuzzy: { label: "模糊", days: 3 },
  forgotten: { label: "忘记", days: 1 },
};

function shiftMonth(year: number, month: number, offset: number) {
  const shifted = new Date(year, month - 1 + offset, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() + 1 };
}

function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const currentDays = new Date(year, month, 0).getDate();
  const previous = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const previousDays = new Date(previous.year, previous.month, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let index = firstWeekday; index > 0; index -= 1) {
    const day = previousDays - index + 1;
    cells.push({ key: `${previous.year}-${previous.month}-${day}`, day, ...previous, position: "prev" });
  }

  for (let day = 1; day <= currentDays; day += 1) {
    cells.push({ key: `${year}-${month}-${day}`, day, year, month, position: "current" });
  }

  for (let day = 1; cells.length < 42; day += 1) {
    cells.push({ key: `${next.year}-${next.month}-${day}`, day, ...next, position: "next" });
  }

  return cells;
}

function buildMonthTasks(
  year: number,
  month: number,
  generatedCards: GeneratedReviewCard[],
  reviewFeedback: Record<string, ReviewFeedback> = {},
) {
  const baseTasks = reviewTasksByMonth[monthKey(year, month)] ?? {};
  const tasks = Object.fromEntries(
    Object.entries(baseTasks).map(([day, items]) => [
      Number(day),
      items.map((item) => ({ ...item, scheduledFor: formatDate(year, month, Number(day)) })),
    ]),
  ) as Record<number, ReviewTask[]>;

  for (const card of generatedCards) {
    const [cardYear, cardMonth, cardDay] = card.scheduledFor.split("-").map(Number);
    if (cardYear !== year || cardMonth !== month || !cardDay) continue;
    const task: ReviewTask = {
      title: card.title,
      course: card.course,
      minutes: card.minutes,
      reason: card.reason,
      icon: FileText,
      href: card.href,
      scheduledFor: card.scheduledFor,
    };
    tasks[cardDay] = [...(tasks[cardDay] ?? []), task];
  }

  for (const feedback of Object.values(reviewFeedback)) {
    const [feedbackYear, feedbackMonth, feedbackDay] = feedback.nextReviewFor.split("-").map(Number);
    if (feedbackYear !== year || feedbackMonth !== month || !feedbackDay) continue;
    const rating = reviewRatingMeta[feedback.rating];
    const task: ReviewTask = {
      title: feedback.title,
      course: feedback.course,
      minutes: feedback.minutes,
      reason: `根据“${rating.label}”反馈 · ${rating.days} 天后重排`,
      icon: RotateCcw,
      href: feedback.href,
      scheduledFor: feedback.nextReviewFor,
    };
    const dayTasks = tasks[feedbackDay] ?? [];
    if (!dayTasks.some((item) => item.title === task.title)) {
      tasks[feedbackDay] = [...dayTasks, task];
    }
  }

  return tasks;
}

function getDefaultSelectedDay(
  year: number,
  month: number,
  generatedCards: GeneratedReviewCard[],
  reviewFeedback: Record<string, ReviewFeedback>,
) {
  const days = Object.keys(buildMonthTasks(year, month, generatedCards, reviewFeedback)).map(Number).sort((a, b) => a - b);
  return days[0] ?? 1;
}

export function ReviewPage() {
  const [initialOutputs] = useState(() => loadLearningOutputs());
  const [generatedCards] = useState(initialOutputs.reviewCards);
  const [reviewFeedback, setReviewFeedback] = useState(initialOutputs.reviewFeedback);
  const [viewMonth, setViewMonth] = useState({ year: 2026, month: 7 });
  const [selectedDay, setSelectedDay] = useState(23);
  const monthTasks = buildMonthTasks(viewMonth.year, viewMonth.month, generatedCards, reviewFeedback);
  const selectedTasks = monthTasks[selectedDay] ?? [];
  const calendarCells = buildCalendarCells(viewMonth.year, viewMonth.month);
  const todayTasks = buildMonthTasks(2026, 7, generatedCards, reviewFeedback)[23] ?? [];
  const todayMinutes = todayTasks.reduce((sum, task) => sum + task.minutes, 0);

  const moveMonth = (offset: number) => {
    const nextMonth = shiftMonth(viewMonth.year, viewMonth.month, offset);
    setViewMonth(nextMonth);
    setSelectedDay(getDefaultSelectedDay(nextMonth.year, nextMonth.month, generatedCards, reviewFeedback));
  };

  const rateTask = (task: ReviewTask, rating: ReviewRating) => {
    const scheduledFor = task.scheduledFor ?? formatDate(viewMonth.year, viewMonth.month, selectedDay);
    const meta = reviewRatingMeta[rating];
    const feedback: ReviewFeedback = {
      id: `${scheduledFor}:${task.title}`,
      title: task.title,
      course: task.course,
      minutes: task.minutes,
      reason: task.reason,
      href: task.href,
      scheduledFor,
      rating,
      nextReviewFor: addDays(scheduledFor, meta.days),
      answeredAt: new Date().toISOString(),
    };
    const outputs = saveReviewFeedback(feedback);
    setReviewFeedback(outputs.reviewFeedback);
  };

  const selectCalendarCell = (cell: CalendarCell) => {
    setViewMonth({ year: cell.year, month: cell.month });
    setSelectedDay(cell.day);
  };

  return (
    <div className="page-inner page-surface module-page review-page">
      <header className="cs-page-header module-page-header">
        <div>
          <p className="cs-workspace-kicker">复习安排 · {viewMonth.year} 年 {viewMonth.month} 月</p>
          <h1>复习日历</h1>
          <p>依据遗忘风险、错题回访与独立验证结果安排复习，而不是平均分配学习时间。</p>
        </div>
        <span className="review-streak"><CalendarDays aria-hidden="true" size={15} /><span><strong>连续学习 12 天</strong><small>本周完成率 86%</small></span></span>
      </header>

      <section className="today-review-queue" aria-labelledby="today-review-title">
        <header><span><Clock3 aria-hidden="true" size={16} /></span><div><small>今天</small><h2 id="today-review-title">今日复习队列</h2></div><strong>{todayTasks.length} 项 · {todayMinutes} 分钟</strong></header>
        <ol>
          {todayTasks.map((task, index) => {
            const Icon = task.icon;
            return <li key={task.title}><span>0{index + 1}</span><Icon aria-hidden="true" size={15} /><div><strong>{task.title}</strong><small>{task.course} · {task.reason}</small></div><time>{task.minutes} min</time></li>;
          })}
        </ol>
        <Link to="/student/plan">按推荐顺序开始 <ChevronRight aria-hidden="true" size={15} /></Link>
      </section>

      <div className="review-calendar-layout">
        <section className="review-calendar" aria-labelledby="review-month-title">
          <header>
            <button aria-label="上个月" onClick={() => moveMonth(-1)} title="上个月" type="button"><ChevronLeft aria-hidden="true" size={16} /></button>
            <div><span>复习安排</span><h2 id="review-month-title">{viewMonth.year} 年 {viewMonth.month} 月</h2></div>
            <button aria-label="下个月" onClick={() => moveMonth(1)} title="下个月" type="button"><ChevronRight aria-hidden="true" size={16} /></button>
          </header>
          <div className="calendar-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div className="calendar-grid">
            {calendarCells.map((cell) => {
              const cellTasks = buildMonthTasks(cell.year, cell.month, generatedCards, reviewFeedback)[cell.day] ?? [];
              const count = cellTasks.length;
              const label = `${cell.month} 月 ${cell.day} 日，${count} 个复习任务`;
              const isToday = cell.year === 2026 && cell.month === 7 && cell.day === 23;
              const isSelected = cell.position === "current" && cell.day === selectedDay;
              return (
                <button
                  aria-label={label}
                  className={`${cell.position !== "current" ? "outside" : ""}${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
                  key={cell.key}
                  onClick={() => selectCalendarCell(cell)}
                  type="button"
                >
                  <span>{cell.day}</span>
                  {count > 0 ? <i>{count} 项</i> : null}
                  {count > 0 ? <em>{Array.from({ length: Math.min(count, 3) }, (_, index) => <b key={index} />)}</em> : null}
                </button>
              );
            })}
          </div>
        </section>

        <aside aria-label="所选日期复习任务" className="review-day-panel">
          <header><span>当天任务</span><h2>{viewMonth.month} 月 {selectedDay} 日</h2><small>{selectedTasks.length} 个复习任务</small></header>
          {selectedTasks.length ? (
            <ol>
              {selectedTasks.map((task) => {
                const Icon = task.icon;
                const scheduledFor = task.scheduledFor ?? formatDate(viewMonth.year, viewMonth.month, selectedDay);
                const feedback = reviewFeedback[`${scheduledFor}:${task.title}`];
                return (
                  <li key={task.title}>
                    <span><Icon aria-hidden="true" size={15} /></span>
                    <div className="review-task-copy"><small>{task.course}</small><strong>{task.title}</strong><p>{task.reason}</p></div>
                    <time>{task.minutes} min</time>
                    <Link aria-label={`打开${task.title}`} to={task.href}><ChevronRight aria-hidden="true" size={14} /></Link>
                    <div className="review-rating-actions">
                      <span>回忆结果</span>
                      <button aria-label={`将 ${task.title} 标记为掌握`} className={feedback?.rating === "mastered" ? "active" : ""} onClick={() => rateTask(task, "mastered")} type="button"><ThumbsUp aria-hidden="true" size={12} />掌握</button>
                      <button aria-label={`将 ${task.title} 标记为模糊`} className={feedback?.rating === "fuzzy" ? "active" : ""} onClick={() => rateTask(task, "fuzzy")} type="button"><Waves aria-hidden="true" size={12} />模糊</button>
                      <button aria-label={`将 ${task.title} 标记为忘记`} className={feedback?.rating === "forgotten" ? "active" : ""} onClick={() => rateTask(task, "forgotten")} type="button"><ThumbsDown aria-hidden="true" size={12} />忘记</button>
                      {feedback ? <em>已重新安排至 {formatShortDate(feedback.nextReviewFor)}</em> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <div className="review-empty"><CalendarDays aria-hidden="true" size={22} /><strong>当天没有安排复习</strong><span>可以保留为自主学习时间。</span></div>}
          <footer><Target aria-hidden="true" size={13} /> 下次调度会在独立验证后更新</footer>
        </aside>
      </div>
    </div>
  );
}
