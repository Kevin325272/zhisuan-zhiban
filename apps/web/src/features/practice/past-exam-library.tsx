import type { PastExamCatalogResponse } from "@xuetu/contracts";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CircleAlert,
  RotateCcw,
} from "lucide-react";
import { Link } from "react-router-dom";

interface PastExamLibraryProps {
  catalog: PastExamCatalogResponse | null;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}

export function PastExamLibrary({ catalog, error, loading, onRetry }: PastExamLibraryProps) {
  if (loading) {
    return (
      <section className="past-exam-load-state" role="status" aria-live="polite">
        <BookOpenCheck aria-hidden="true" size={22} />
        <div>
          <strong>正在读取历年真题…</strong>
          <p>正在整理年份与个人作答进度。</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="past-exam-load-state error" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <div>
          <strong>{error}</strong>
          <button onClick={onRetry} type="button">
            <RotateCcw aria-hidden="true" size={15} />重新读取真题目录
          </button>
        </div>
      </section>
    );
  }

  if (!catalog || catalog.items.length === 0) {
    return (
      <section className="past-exam-load-state empty" aria-label="历年真题目录">
        <BookOpenCheck aria-hidden="true" size={22} />
        <div>
          <strong>真题试卷整理中</strong>
          <p>目前还没有可练习的年份卷，可以先学习课程、巩固知识点。</p>
          <div className="past-exam-empty-actions"><Link to="/student/courses">去课程学习<ArrowRight size={16} /></Link><button onClick={onRetry} type="button"><RotateCcw size={15} />刷新目录</button></div>
        </div>
      </section>
    );
  }

  return (
    <section className="past-exam-library" aria-label="历年真题目录">
      <header>
        <div>
          <span>2009—2026</span>
          <h2>按年份进入完整试卷</h2>
        </div>
        <strong>{catalog.items.length} 套</strong>
      </header>
      <ol className="past-exam-year-list">
        {catalog.items.map((paper) => {
          const nextQuestion = paper.next_question_number ?? 1;
          const actionLabel = paper.attempted_count === paper.question_count
            ? "重新练习"
            : paper.attempted_count > 0
              ? `继续第 ${nextQuestion} 题`
              : "开始练习";
          const href = `/student/practice?mode=past_exam&year=${paper.year}&question=${nextQuestion}`;
          return (
            <li key={paper.year}>
              <article className="past-exam-year-row">
                <div className="past-exam-year-mark" aria-hidden="true">
                  <strong>{paper.year}</strong>
                  <span>408</span>
                </div>
                <div className="past-exam-year-copy">
                  <h3>{paper.year} 年真题</h3>
                  <p>{paper.question_count} 题 · {paper.choice_count} 道选择 · {paper.subjective_count} 道主观</p>
                  <ul aria-label={`${paper.year} 年科目题量`}>
                    {paper.subjects.map((item) => (
                      <li key={item.subject}>{item.subject} {item.question_count}</li>
                    ))}
                  </ul>
                </div>
                <div className="past-exam-year-progress">
                  <span>已完成 {paper.attempted_count} / {paper.question_count} 题</span>
                  <div
                    aria-label={`${paper.year} 年真题完成 ${Math.round((paper.attempted_count / paper.question_count) * 100)}%`}
                    aria-valuemax={paper.question_count}
                    aria-valuemin={0}
                    aria-valuenow={paper.attempted_count}
                    role="progressbar"
                  >
                    <span style={{ width: `${(paper.attempted_count / paper.question_count) * 100}%` }} />
                  </div>
                </div>
                {paper.is_complete ? (
                  <Link className="past-exam-open-action" to={href}>
                    {actionLabel}<ArrowRight aria-hidden="true" size={16} />
                  </Link>
                ) : (
                  <span className="past-exam-incomplete">题卷待补齐</span>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface PastExamPaperNavigatorProps {
  currentQuestion: number;
  onSelectQuestion: (questionNumber: number) => void;
  questionCount: number;
  year: number;
}

export function PastExamPaperNavigator({
  currentQuestion,
  onSelectQuestion,
  questionCount,
  year,
}: PastExamPaperNavigatorProps) {
  const numbers = Array.from({ length: questionCount }, (_, index) => index + 1);
  return (
    <section className="past-exam-paper-toolbar">
      <header>
        <Link to="/student/practice?mode=past_exam">
          <ArrowLeft aria-hidden="true" size={16} />返回年份目录
        </Link>
        <div>
          <strong>{year} 年 408 真题</strong>
          <span>第 {currentQuestion} / {questionCount} 题</span>
        </div>
        <div className="past-exam-step-actions">
          <button
            aria-label="上一题"
            disabled={currentQuestion <= 1}
            onClick={() => onSelectQuestion(currentQuestion - 1)}
            title="上一题"
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="下一题"
            disabled={currentQuestion >= questionCount}
            onClick={() => onSelectQuestion(currentQuestion + 1)}
            title="下一题"
            type="button"
          >
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </header>
      <nav aria-label={`${year} 年真题题号`}>
        <ol>
          {numbers.map((number) => (
            <li key={number}>
              <button
                aria-current={number === currentQuestion ? "step" : undefined}
                aria-label={`跳到第 ${number} 题`}
                className={number === currentQuestion ? "active" : ""}
                onClick={() => onSelectQuestion(number)}
                type="button"
              >
                {number}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </section>
  );
}
