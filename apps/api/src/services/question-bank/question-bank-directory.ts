import type { PracticeSelection } from "@xuetu/contracts";
import type { SqlQueryablePool } from "../../database/client.js";
import type { QuestionBankService } from "./question-bank.js";

export interface QuestionBankDirectory {
  forSelection(selection: PracticeSelection): Promise<QuestionBankService | null>;
  forQuestion(questionId: string): Promise<QuestionBankService | null>;
}

const subjectCourses: Record<string, string> = {
  数据结构: "course_408_ds", 组成原理: "course_408_co",
  操作系统: "course_408_os", 计算机网络: "course_408_cn",
};

/** Resolves the owner course only. Routes must still check membership before using a bank. */
export class PostgresQuestionBankDirectory implements QuestionBankDirectory {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly shared: QuestionBankService,
    private readonly courses: ReadonlyMap<string, QuestionBankService>,
  ) {}
  private bank(courseId?: string) {
    return courseId === this.shared.courseId ? this.shared : courseId ? this.courses.get(courseId) ?? null : null;
  }
  async forQuestion(questionId: string) {
    const result = await this.pool.query<{ course_id: string }>("SELECT course_id FROM questions WHERE question_id=$1", [questionId]);
    return this.bank(result.rows[0]?.course_id);
  }
  async forSelection(selection: PracticeSelection) {
    if (selection.mode === "past_exam" || selection.mode === "mock_exam") return this.shared;
    if (selection.question_id) return this.forQuestion(selection.question_id);
    if (selection.concept_id) {
      const result = await this.pool.query<{ course_id: string }>("SELECT course_id FROM course_core_concepts WHERE concept_id=$1", [selection.concept_id]);
      return this.bank(result.rows[0]?.course_id);
    }
    return this.bank(selection.subject ? subjectCourses[selection.subject] : undefined) ?? this.shared;
  }
}
