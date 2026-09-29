import type {
  ExternalQuestionConfirmation,
  ExternalQuestionDepth,
  ExternalQuestionDetail,
  ExternalQuestionListItem,
  ExternalQuestionOption,
  ExternalQuestionSubject,
  ExternalQuestionType,
} from "@xuetu/contracts";
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CircleAlert,
  FileImage,
  ImageUp,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  confirmExternalQuestion,
  deleteExternalQuestion,
  explainExternalQuestion,
  getExternalQuestion,
  getExternalQuestions,
  retryExternalQuestionRecognition,
  saveExternalQuestion,
  uploadExternalQuestion,
} from "../../api/client";

type WorkspacePhase =
  | "empty"
  | "selected"
  | "uploading"
  | "recognized"
  | "confirming"
  | "confirmed"
  | "explaining"
  | "ready"
  | "failed";

interface ConfirmationDraft {
  subject: ExternalQuestionSubject | "";
  question_type: ExternalQuestionType | "";
  question_text: string;
  options: ExternalQuestionOption[];
  formulae: string[];
  diagram_description: string | null;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const SUBJECT_OPTIONS: Array<{ value: ExternalQuestionSubject; label: string }> = [
  { value: "data_structures", label: "数据结构" },
  { value: "computer_organization", label: "计算机组成原理" },
  { value: "operating_systems", label: "操作系统" },
  { value: "computer_networks", label: "计算机网络" },
];

const DEPTH_OPTIONS: Array<{
  value: ExternalQuestionDepth;
  label: string;
}> = [
  { value: "direction", label: "只给方向" },
  { value: "steps", label: "分步讲解" },
  { value: "complete", label: "完整解析" },
];

function operationKey(operation: string) {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `external-${operation}-${suffix}`;
}

function draftFromDetail(question: ExternalQuestionDetail): ConfirmationDraft | null {
  const source = question.confirmation ?? question.recognition;
  if (!source) return null;
  return {
    subject: source.subject === "unknown" ? "" : source.subject,
    question_type: source.question_type === "unknown" ? "" : source.question_type,
    question_text: source.question_text,
    options: source.options.map((option) => ({ ...option })),
    formulae: [...source.formulae],
    diagram_description: source.diagram_description,
  };
}

function readableError(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === "AbortError";
}

function subjectLabel(subject: ExternalQuestionSubject | null) {
  return SUBJECT_OPTIONS.find((option) => option.value === subject)?.label ?? "待确认科目";
}

function phaseStepState(phase: WorkspacePhase, step: 1 | 2 | 3) {
  const reached = phase === "recognized" || phase === "confirming"
    ? 2
    : phase === "confirmed" || phase === "explaining" || phase === "ready"
      ? 3
      : 1;
  if (step < reached) return "complete";
  if (step === reached) return "active";
  return "pending";
}

export function PhotoTutorPage() {
  const [phase, setPhase] = useState<WorkspacePhase>("empty");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState<ExternalQuestionDetail | null>(null);
  const [draft, setDraft] = useState<ConfirmationDraft | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [selectedDepth, setSelectedDepth] = useState<ExternalQuestionDepth | null>(null);
  const [savedItems, setSavedItems] = useState<ExternalQuestionListItem[]>([]);
  const [savedItemsLoading, setSavedItemsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [retryQuestionId, setRetryQuestionId] = useState<string | null>(null);
  const [failedOperation, setFailedOperation] = useState<"recognition" | "explanation" | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<{
    sequence: number;
    controller: AbortController;
  } | null>(null);

  const releaseObjectPreview = () => {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  };

  const cancelActiveRequest = () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    requestSequenceRef.current += 1;
  };

  const beginRequest = () => {
    cancelActiveRequest();
    const activeRequest = {
      sequence: requestSequenceRef.current,
      controller: new AbortController(),
    };
    activeRequestRef.current = activeRequest;
    return activeRequest;
  };

  const isActiveRequest = (activeRequest: {
    sequence: number;
    controller: AbortController;
  }) => activeRequestRef.current?.sequence === activeRequest.sequence
    && activeRequestRef.current.controller === activeRequest.controller
    && !activeRequest.controller.signal.aborted;

  const finishRequest = (activeRequest: {
    sequence: number;
    controller: AbortController;
  }) => {
    if (activeRequestRef.current?.sequence === activeRequest.sequence) {
      activeRequestRef.current = null;
    }
  };

  useEffect(() => () => {
    cancelActiveRequest();
    releaseObjectPreview();
  }, []);

  const refreshSavedItems = async () => {
    const activeRequest = beginRequest();
    try {
      const result = await getExternalQuestions(activeRequest.controller.signal);
      if (!isActiveRequest(activeRequest)) return;
      setSavedItems(result.items);
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      setSavedItems([]);
    } finally {
      if (isActiveRequest(activeRequest)) {
        setSavedItemsLoading(false);
        finishRequest(activeRequest);
      }
    }
  };

  useEffect(() => {
    void refreshSavedItems();
  }, []);

  const applyQuestion = (next: ExternalQuestionDetail, usePrivateImage = false) => {
    setQuestion(next);
    setRetryQuestionId(next.external_question_id);
    const nextDraft = draftFromDetail(next);
    setDraft(nextDraft);
    setDraftDirty(next.confirmation === null);
    setErrorMessage(null);
    setRetryable(false);
    setFailedOperation(null);
    if (usePrivateImage) {
      releaseObjectPreview();
      setSelectedFile(null);
      setPreviewUrl(next.image_url);
    }
    const latestExplanation = next.explanations.at(-1) ?? null;
    if (latestExplanation) {
      setSelectedDepth(latestExplanation.depth);
      setPhase("ready");
    } else if (next.confirmation) {
      setSelectedDepth(null);
      setPhase("confirmed");
    } else if (next.recognition?.status === "recognized") {
      setSelectedDepth(null);
      setPhase("recognized");
    } else {
      setPhase("failed");
      setErrorMessage(next.recognition?.warnings.join(" ") || "这张图片暂时无法识别。");
      setRetryable(true);
      setFailedOperation("recognition");
    }
  };

  const resetWorkspace = () => {
    cancelActiveRequest();
    releaseObjectPreview();
    setPhase("empty");
    setSelectedFile(null);
    setPreviewUrl(null);
    setQuestion(null);
    setDraft(null);
    setDraftDirty(false);
    setSelectedDepth(null);
    setErrorMessage(null);
    setStatusMessage(null);
    setRetryable(false);
    setRetryQuestionId(null);
    setFailedOperation(null);
  };

  const chooseFiles = (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length !== 1) {
      setErrorMessage("一次只能选择一张题目图片。");
      setRetryable(false);
      return;
    }
    const file = candidates[0];
    if (!file || !ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setErrorMessage("仅支持 PNG、JPEG 或 WebP 图片。");
      setRetryable(false);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMessage("题目图片不能超过 5 MiB。");
      setRetryable(false);
      return;
    }

    cancelActiveRequest();
    releaseObjectPreview();
    const nextPreviewUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextPreviewUrl;
    setSelectedFile(file);
    setPreviewUrl(nextPreviewUrl);
    setQuestion(null);
    setDraft(null);
    setDraftDirty(false);
    setSelectedDepth(null);
    setPhase("selected");
    setErrorMessage(null);
    setStatusMessage(null);
    setRetryable(false);
    setRetryQuestionId(null);
    setFailedOperation(null);
  };

  const markFailure = (
    error: unknown,
    fallback: string,
    operation: "recognition" | "explanation",
  ) => {
    setPhase("failed");
    setErrorMessage(readableError(error, fallback));
    setFailedOperation(operation);
    if (error instanceof ApiError) {
      setRetryable(error.retryable);
      const externalQuestionId = error.details.external_question_id;
      if (typeof externalQuestionId === "string") setRetryQuestionId(externalQuestionId);
    } else {
      setRetryable(false);
    }
  };

  const recognizeSelectedImage = async () => {
    if (!selectedFile || phase === "uploading") return;
    const activeRequest = beginRequest();
    setPhase("uploading");
    setErrorMessage(null);
    setStatusMessage("正在识别题目图片");
    try {
      const result = await uploadExternalQuestion(
        selectedFile,
        operationKey("upload"),
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      applyQuestion(result);
      setStatusMessage(result.recognition?.status === "recognized" ? "识别完成，请核对题目内容" : null);
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      markFailure(error, "题目识别失败，请稍后重试。", "recognition");
      setStatusMessage(null);
    } finally {
      finishRequest(activeRequest);
    }
  };

  const retryRecognition = async () => {
    const externalQuestionId = retryQuestionId ?? question?.external_question_id;
    if (!externalQuestionId) return;
    const activeRequest = beginRequest();
    setPhase("uploading");
    setErrorMessage(null);
    setStatusMessage("正在重新识别题目图片");
    try {
      const result = await retryExternalQuestionRecognition(
        externalQuestionId,
        operationKey("recognize"),
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      applyQuestion(result);
      setStatusMessage("识别完成，请核对题目内容");
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      markFailure(error, "重新识别失败，请稍后再试。", "recognition");
      setStatusMessage(null);
    } finally {
      finishRequest(activeRequest);
    }
  };

  const updateDraft = (next: ConfirmationDraft) => {
    setDraft(next);
    setDraftDirty(true);
    setStatusMessage(null);
    if (question?.confirmation) setPhase("recognized");
  };

  const confirmationInput = (): ExternalQuestionConfirmation | null => {
    if (!draft?.subject || !draft.question_type || !draft.question_text.trim()) {
      setErrorMessage("请确认科目、题型和题干后再继续。");
      return null;
    }
    const options = draft.question_type === "subjective"
      ? []
      : draft.options.map((option) => ({
          label: option.label.trim(),
          text: option.text.trim(),
        }));
    if (
      draft.question_type === "choice"
      && (options.length < 2 || options.some((option) => !option.label || !option.text))
    ) {
      setErrorMessage("选择题至少需要两个完整选项。");
      return null;
    }
    return {
      subject: draft.subject,
      question_type: draft.question_type,
      question_text: draft.question_text.trim(),
      options,
      formulae: draft.formulae.map((formula) => formula.trim()).filter(Boolean),
      diagram_description: draft.diagram_description?.trim() || null,
    };
  };

  const confirmQuestion = async () => {
    if (!question || phase === "confirming") return;
    const input = confirmationInput();
    if (!input) return;
    const activeRequest = beginRequest();
    setPhase("confirming");
    setErrorMessage(null);
    setStatusMessage("正在确认题目内容");
    try {
      const result = await confirmExternalQuestion(
        question.external_question_id,
        input,
        operationKey("confirm"),
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      applyQuestion(result);
      setDraftDirty(false);
      setStatusMessage("题目内容已确认");
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      setPhase("recognized");
      setErrorMessage(readableError(error, "题目确认失败，请检查内容后重试。"));
      setStatusMessage(null);
    } finally {
      finishRequest(activeRequest);
    }
  };

  const requestExplanation = async (depth: ExternalQuestionDepth) => {
    if (!question?.confirmation || draftDirty || phase === "explaining") return;
    const activeRequest = beginRequest();
    setSelectedDepth(depth);
    setPhase("explaining");
    setErrorMessage(null);
    setStatusMessage(`正在生成${DEPTH_OPTIONS.find((item) => item.value === depth)?.label ?? "讲解"}`);
    try {
      const result = await explainExternalQuestion(
        question.external_question_id,
        depth,
        operationKey("explain"),
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      applyQuestion(result);
      setSelectedDepth(depth);
      setStatusMessage("讲解已生成");
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      markFailure(error, "讲解暂时不可用，请稍后重试。", "explanation");
      setStatusMessage(null);
    } finally {
      finishRequest(activeRequest);
    }
  };

  const saveQuestion = async () => {
    if (!question?.confirmation || draftDirty) return;
    const activeRequest = beginRequest();
    setErrorMessage(null);
    try {
      const result = await saveExternalQuestion(
        question.external_question_id,
        operationKey("save"),
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      setQuestion(result);
      setStatusMessage("已保存到个人题目");
      finishRequest(activeRequest);
      await refreshSavedItems();
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      setErrorMessage(readableError(error, "保存失败，请稍后重试。"));
    } finally {
      finishRequest(activeRequest);
    }
  };

  const loadSavedQuestion = async (item: ExternalQuestionListItem) => {
    const activeRequest = beginRequest();
    setErrorMessage(null);
    setStatusMessage("正在读取个人题目");
    try {
      const result = await getExternalQuestion(
        item.external_question_id,
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      applyQuestion(result, true);
      setStatusMessage("个人题目已打开");
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      setErrorMessage(readableError(error, "个人题目读取失败。"));
      setStatusMessage(null);
    } finally {
      finishRequest(activeRequest);
    }
  };

  const removeQuestion = async () => {
    if (!question) return;
    const activeRequest = beginRequest();
    setErrorMessage(null);
    try {
      await deleteExternalQuestion(
        question.external_question_id,
        operationKey("delete"),
        activeRequest.controller.signal,
      );
      if (!isActiveRequest(activeRequest)) return;
      finishRequest(activeRequest);
      resetWorkspace();
      setStatusMessage("题目已删除");
      await refreshSavedItems();
    } catch (error) {
      if (!isActiveRequest(activeRequest) || isAbortError(error)) return;
      setErrorMessage(readableError(error, "删除失败，请稍后重试。"));
    } finally {
      finishRequest(activeRequest);
    }
  };

  const confirmed = Boolean(question?.confirmation && !draftDirty);
  const activeExplanation = useMemo(() => {
    if (!question || draftDirty) return null;
    if (selectedDepth) {
      return [...question.explanations]
        .reverse()
        .find((explanation) => explanation.depth === selectedDepth) ?? null;
    }
    return question.explanations.at(-1) ?? null;
  }, [draftDirty, question, selectedDepth]);

  const previewAlt = question ? "题目原图" : "待识别题目预览";

  return (
    <div className="page-inner photo-tutor-page first-release-workspace" data-visual-system="ochre-serif">
      <header className="practice-center-heading photo-tutor-heading">
        <div>
          <Link className="practice-course-back" to="/student/practice">
            <ArrowLeft aria-hidden="true" size={14} /> 返回题库训练
          </Link>
          <h1>拍照讲题</h1>
        </div>
        <span className="runtime-truth-label"><BookOpenCheck aria-hidden="true" size={15} /> 私有题目</span>
      </header>

      <nav aria-label="讲题步骤" className="photo-tutor-steps">
        <ol>
          {[{ step: 1 as const, label: "题图" }, { step: 2 as const, label: "核对" }, { step: 3 as const, label: "讲解" }].map((item) => (
            <li data-state={phaseStepState(phase, item.step)} key={item.step}>
              <span>{phaseStepState(phase, item.step) === "complete" ? <Check aria-hidden="true" size={14} /> : item.step}</span>
              <strong>{item.label}</strong>
            </li>
          ))}
        </ol>
      </nav>

      {savedItems.length > 0 ? (
        <section aria-label="个人题目" className="photo-tutor-saved-strip">
          <header>
            <strong>个人题目</strong>
            <span>{savedItems.length} 道</span>
          </header>
          <div>
            {savedItems.map((item) => (
              <button
                key={item.external_question_id}
                onClick={() => void loadSavedQuestion(item)}
                type="button"
              >
                <small>{subjectLabel(item.subject)}</small>
                <span>{item.question_excerpt ?? "待确认题目"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : savedItemsLoading ? (
        <span className="sr-only" role="status">正在读取个人题目</span>
      ) : null}

      <div className="photo-tutor-workspace">
        <section className="photo-tutor-image-panel" aria-labelledby="photo-tutor-image-title">
          <header>
            <div>
              <span>第 1 步</span>
              <h2 id="photo-tutor-image-title">{previewUrl ? "题目原图" : "上传一张 408 题图"}</h2>
            </div>
            {previewUrl ? (
              <button aria-label="选择另一张图片" className="icon-button" onClick={resetWorkspace} title="选择另一张图片" type="button">
                <X aria-hidden="true" size={17} />
              </button>
            ) : null}
          </header>

          <div
            aria-label="打开题目图片选择器"
            className={`photo-tutor-drop-zone${previewUrl ? " has-preview" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFiles(event.dataTransfer.files);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              fileInputRef.current?.click();
            }}
            onPaste={(event) => chooseFiles(event.clipboardData.files)}
            role="button"
            tabIndex={0}
          >
            {previewUrl ? (
              <img alt={previewAlt} height={1200} src={previewUrl} width={1600} />
            ) : (
              <div className="photo-tutor-empty-image">
                <FileImage aria-hidden="true" size={34} strokeWidth={1.5} />
                <strong>PNG / JPEG / WebP</strong>
                <span>单张不超过 5 MiB</span>
              </div>
            )}
          </div>

          <footer className="photo-tutor-image-actions">
            <label className="secondary-button photo-tutor-file-control">
              <ImageUp aria-hidden="true" size={16} />
              {selectedFile ? "更换图片" : "选择题目图片"}
              <input
                accept="image/png,image/jpeg,image/webp"
                aria-label="选择题目图片"
                onChange={(event) => {
                  if (event.target.files) chooseFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />
            </label>
            {selectedFile ? <span className="photo-tutor-file-name">{selectedFile.name}</span> : null}
            <button
              className="first-release-primary-action"
              disabled={!selectedFile || phase === "uploading"}
              onClick={() => void recognizeSelectedImage()}
              type="button"
            >
              {phase === "uploading" ? <LoaderCircle aria-hidden="true" className="photo-tutor-spinner" size={16} /> : <ImageUp aria-hidden="true" size={16} />}
              {phase === "uploading" ? "正在识别" : "识别题目"}
            </button>
          </footer>

          {savedItems.length === 0 && !savedItemsLoading ? (
            <p className="photo-tutor-storage-note">尚未保存个人题目</p>
          ) : null}
        </section>

        <section className="photo-tutor-review-panel">
          <header>
            <span>第 2 步</span>
            <h2>核对识别结果</h2>
          </header>

          {errorMessage ? (
            <div className="photo-tutor-error" role="alert">
              <CircleAlert aria-hidden="true" size={18} />
              <span>{errorMessage}</span>
              {retryable && failedOperation === "recognition" && retryQuestionId ? (
                <button onClick={() => void retryRecognition()} type="button">
                  <RefreshCw aria-hidden="true" size={14} /> 重新识别
                </button>
              ) : retryable && failedOperation === "explanation" && selectedDepth ? (
                <button onClick={() => void requestExplanation(selectedDepth)} type="button">
                  <RefreshCw aria-hidden="true" size={14} /> 重试讲解
                </button>
              ) : null}
            </div>
          ) : null}

          <p aria-live="polite" className="photo-tutor-live-status" role="status">
            {statusMessage}
          </p>

          {draft ? (
            <form
              className="photo-tutor-confirmation-form"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmQuestion();
              }}
            >
              {question?.recognition?.warnings.length ? (
                <ul className="photo-tutor-warnings">
                  {question.recognition.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : null}

              <div className="photo-tutor-field-row">
                <label>
                  科目
                  <select
                    aria-label="科目"
                    onChange={(event) => updateDraft({
                      ...draft,
                      subject: event.target.value as ConfirmationDraft["subject"],
                    })}
                    value={draft.subject}
                  >
                    <option value="">请选择科目</option>
                    {SUBJECT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  题型
                  <select
                    aria-label="题型"
                    onChange={(event) => {
                      const questionType = event.target.value as ConfirmationDraft["question_type"];
                      updateDraft({
                        ...draft,
                        question_type: questionType,
                        options: questionType === "subjective" ? [] : draft.options,
                      });
                    }}
                    value={draft.question_type}
                  >
                    <option value="">请选择题型</option>
                    <option value="choice">选择题</option>
                    <option value="subjective">主观题</option>
                  </select>
                </label>
              </div>

              <label>
                题干
                <textarea
                  aria-label="题干"
                  onChange={(event) => updateDraft({ ...draft, question_text: event.target.value })}
                  rows={5}
                  value={draft.question_text}
                />
              </label>

              {draft.question_type === "choice" ? (
                <fieldset className="photo-tutor-options-editor">
                  <legend>选项</legend>
                  {draft.options.map((option, index) => (
                    <div key={`${index}-${option.label}`}>
                      <input
                        aria-label={`选项 ${index + 1} 标号`}
                        className="photo-tutor-option-label"
                        maxLength={10}
                        onChange={(event) => updateDraft({
                          ...draft,
                          options: draft.options.map((item, optionIndex) => optionIndex === index
                            ? { ...item, label: event.target.value }
                            : item),
                        })}
                        value={option.label}
                      />
                      <input
                        aria-label={`选项 ${option.label || index + 1}`}
                        onChange={(event) => updateDraft({
                          ...draft,
                          options: draft.options.map((item, optionIndex) => optionIndex === index
                            ? { ...item, text: event.target.value }
                            : item),
                        })}
                        value={option.text}
                      />
                      <button
                        aria-label={`删除选项 ${option.label || index + 1}`}
                        className="icon-button"
                        onClick={() => updateDraft({
                          ...draft,
                          options: draft.options.filter((_, optionIndex) => optionIndex !== index),
                        })}
                        title="删除选项"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="photo-tutor-add-option"
                    onClick={() => updateDraft({
                      ...draft,
                      options: [
                        ...draft.options,
                        {
                          label: String.fromCharCode(65 + draft.options.length),
                          text: "",
                        },
                      ],
                    })}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={14} /> 添加选项
                  </button>
                </fieldset>
              ) : null}

              <label>
                公式
                <textarea
                  aria-label="公式"
                  onChange={(event) => updateDraft({
                    ...draft,
                    formulae: event.target.value.split("\n"),
                  })}
                  placeholder="每行一项"
                  rows={2}
                  value={draft.formulae.join("\n")}
                />
              </label>

              <label>
                图示描述
                <textarea
                  aria-label="图示描述"
                  onChange={(event) => updateDraft({
                    ...draft,
                    diagram_description: event.target.value || null,
                  })}
                  rows={3}
                  value={draft.diagram_description ?? ""}
                />
              </label>

              <footer>
                <span>{confirmed ? <><Check aria-hidden="true" size={15} /> 已确认</> : "确认后才能开始讲解"}</span>
                <button
                  className="first-release-primary-action"
                  disabled={phase === "confirming" || !draftDirty}
                  type="submit"
                >
                  {phase === "confirming" ? <LoaderCircle aria-hidden="true" className="photo-tutor-spinner" size={16} /> : <Check aria-hidden="true" size={16} />}
                  {phase === "confirming" ? "正在确认" : "确认题目"}
                </button>
              </footer>
            </form>
          ) : (
            <div className="photo-tutor-empty-review">
              <span>识别完成后显示待核对题目</span>
            </div>
          )}

          <section className="photo-tutor-explanation-stage">
            <header>
              <span>第 3 步</span>
              <h2>选择讲解深度</h2>
            </header>
            <div aria-label="讲解深度" className="photo-tutor-depth-control" role="group">
              {DEPTH_OPTIONS.map((option) => (
                <button
                  aria-pressed={selectedDepth === option.value}
                  className={selectedDepth === option.value ? "active" : ""}
                  disabled={!confirmed || phase === "explaining"}
                  key={option.value}
                  onClick={() => void requestExplanation(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>

            {activeExplanation ? (
              <article aria-label="题目讲解" className="photo-tutor-explanation" role="region">
                <h3>{activeExplanation.summary}</h3>
                {activeExplanation.knowledge_points.length > 0 ? (
                  <dl>
                    {activeExplanation.knowledge_points.map((point) => (
                      <div key={point.concept_id}>
                        <dt>{point.title}</dt>
                        <dd>{point.reason}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <section>
                  <h4>解题方向</h4>
                  <ol>{activeExplanation.approach.map((item) => <li key={item}>{item}</li>)}</ol>
                </section>
                {activeExplanation.steps.length > 0 ? (
                  <section>
                    <h4>推导步骤</h4>
                    <ol>{activeExplanation.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  </section>
                ) : null}
                <p className="photo-tutor-self-check"><strong>自检</strong>{activeExplanation.self_check}</p>
                {activeExplanation.depth === "complete" && activeExplanation.final_answer ? (
                  <section className="photo-tutor-final-answer">
                    <h4>最终答案</h4>
                    <p>{activeExplanation.final_answer}</p>
                  </section>
                ) : null}
              </article>
            ) : null}

            {question?.concept_candidates.length ? (
              <div className="photo-tutor-related-concepts">
                <strong>平台关联</strong>
                {question.concept_candidates.map((candidate) => (
                  <div key={candidate.concept_id}>
                    <span>{candidate.title}</span>
                    <Link to={candidate.reading_href}>查看知识点</Link>
                    <Link to={candidate.practice_href}>练习关联题</Link>
                  </div>
                ))}
              </div>
            ) : null}

            {question ? (
              <footer className="photo-tutor-record-actions">
                <button
                  className="secondary-button"
                  disabled={!confirmed || Boolean(question.saved_at)}
                  onClick={() => void saveQuestion()}
                  type="button"
                >
                  <Save aria-hidden="true" size={15} />
                  {question.saved_at ? "已保存" : "保存到个人题目"}
                </button>
                <button className="photo-tutor-delete-action" onClick={() => void removeQuestion()} type="button">
                  <Trash2 aria-hidden="true" size={15} /> 删除题目
                </button>
              </footer>
            ) : null}
          </section>
        </section>
      </div>
    </div>
  );
}
