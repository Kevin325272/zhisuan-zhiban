const COURSE_TERM_LEXICON = [
  "计算机系统",
  "计算机体系结构",
  "计算机组成",
  "系统软件",
  "应用软件",
  "指令系统",
  "中央处理器",
  "存储系统",
  "输入设备",
  "输出设备",
  "操作系统",
  "数据库管理系统",
  "主存",
  "辅存",
  "存储器",
  "处理器",
  "硬件",
  "软件",
  "总线",
] as const;

const SENTENCE_END = /[。！？!?；;]$/u;
const SENTENCE_PARTS = /[^。！？!?；;]+(?:[。！？!?；;]+|$)/gu;
const CLAUSE_PARTS = /[^，,：:]+(?:[，,：:]+|$)/gu;
const FIGURE_PLACEHOLDER = /\{\{\s*figure\s*:\s*[A-Za-z0-9_-]+\s*\}\}/giu;

function normalizeInlineWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function splitLongSentence(sentence: string, maximumLength = 168) {
  if (sentence.length <= maximumLength) return [sentence];
  const clauses = sentence.match(CLAUSE_PARTS) ?? [sentence];
  const groups: string[] = [];
  let current = "";

  for (const clause of clauses) {
    const normalizedClause = normalizeInlineWhitespace(clause);
    if (!normalizedClause) continue;
    if (current && current.length + normalizedClause.length > maximumLength) {
      groups.push(current);
      current = normalizedClause;
    } else {
      current += normalizedClause;
    }
  }
  if (current) groups.push(current);
  return groups;
}

/**
 * Reflows source text without rewriting it: whitespace is normalized and the
 * existing sentence/clause punctuation determines paragraph boundaries.
 */
export function buildReadingParagraphs(sourceText: string) {
  const normalized = sourceText
    .replace(FIGURE_PLACEHOLDER, "")
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map(normalizeInlineWhitespace)
    .filter(Boolean)
    .join(" ");

  if (!normalized) return [];
  const sentences = (normalized.match(SENTENCE_PARTS) ?? [normalized])
    .flatMap((sentence) => splitLongSentence(normalizeInlineWhitespace(sentence)))
    .filter(Boolean);

  const paragraphs: string[] = [];
  let current = "";
  let sentenceCount = 0;
  for (const sentence of sentences) {
    const nextLength = current.length + sentence.length;
    if (current && (sentenceCount >= 2 || nextLength > 190)) {
      paragraphs.push(current);
      current = sentence;
      sentenceCount = 1;
    } else {
      current = `${current}${current ? " " : ""}${sentence}`;
      sentenceCount += SENTENCE_END.test(sentence) ? 1 : 0;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

function uniqueInOrder(values: readonly string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

export function extractLessonTerms(sourceText: string, chapter: string, maximum = 6) {
  const quoted = Array.from(
    sourceText.matchAll(/[“"]([^“”"\n]{2,12})[”"]/gu),
    (match) => match[1]!.trim(),
  ).filter((term) => !/\s/u.test(term));
  const abbreviations = Array.from(sourceText.matchAll(/\b[A-Z][A-Z0-9/.-]{1,9}\b/gu), (match) => match[0]);
  const glossaryMatches = COURSE_TERM_LEXICON
    .filter((term) => sourceText.includes(term))
    .sort((left, right) => sourceText.indexOf(left) - sourceText.indexOf(right));
  const chapterTopic = chapter.replace(/^\s*\d+(?:\.\d+)*\s*/u, "").trim();
  const candidates = [
    ...(sourceText.includes(chapterTopic) ? [chapterTopic] : []),
    ...glossaryMatches,
    ...quoted,
    ...abbreviations,
  ];
  return uniqueInOrder(candidates).slice(0, maximum);
}

export function getChapterTopic(chapter: string) {
  return chapter.replace(/^\s*\d+(?:\.\d+)*\s*/u, "").trim() || chapter;
}

/**
 * Returns the unchanged source sentence that actually names a figure. OCR/PDF
 * line breaks are collapsed, but the wording is not summarized or rewritten.
 */
export function extractFigureContext(sourceText: string, figureLabel: string) {
  const normalized = sourceText
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map(normalizeInlineWhitespace)
    .filter(Boolean)
    .join(" ");
  const compactLabel = figureLabel.replace(/\s+/gu, "");
  const sentences = (normalized.match(SENTENCE_PARTS) ?? [normalized])
    .map(normalizeInlineWhitespace)
    .filter(Boolean);
  return sentences.find((sentence) => sentence.replace(/\s+/gu, "").includes(compactLabel)) ?? null;
}

type QaCandidate = {
  qa_id: string;
  question: string;
  answer: string;
};

export function selectRelatedQa<T extends QaCandidate>(items: readonly T[], terms: readonly string[]) {
  if (items.length === 0) return { example: null, matchedTerms: [] as string[] };
  let selected = items[0]!;
  let selectedMatches: string[] = [];

  for (const item of items) {
    const matches = terms.filter((term) => term.length >= 2 && item.question.includes(term));
    if (matches.length > selectedMatches.length) {
      selected = item;
      selectedMatches = matches;
    }
  }
  return { example: selected, matchedTerms: selectedMatches };
}

type PracticeConcept = {
  concept_id: string;
  practice_question_count?: number | undefined;
};

export function resolvePracticeRoute(baseHref: string, concept: PracticeConcept) {
  const questionCount = concept.practice_question_count ?? 0;
  if (questionCount <= 0) {
    return { href: baseHref, mode: "course" as const, questionCount: 0 };
  }

  const separator = baseHref.includes("?") ? "&" : "?";
  return {
    href: `${baseHref}${separator}concept_id=${encodeURIComponent(concept.concept_id)}`,
    mode: "concept" as const,
    questionCount,
  };
}
