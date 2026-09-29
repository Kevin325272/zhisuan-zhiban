import type {
  MemoryCard,
  MemoryCardSeed,
  MemoryCardWrite,
} from "@xuetu/contracts";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { studyLibraryApi as api } from "./study-library-api";
import { studyError } from "./study-tools";
import { CardContent } from "./card-content";
const subjects: MemoryCardWrite["subject"][] = [
  "通用",
  "数据结构",
  "组成原理",
  "操作系统",
  "计算机网络",
];
export function MemoryCardEditor({
  card,
  initial,
  onSaved,
  onClose,
}: {
  card?: MemoryCard;
  initial?: MemoryCardWrite;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MemoryCardWrite>(
    card
      ? {
          front: card.front,
          back: card.back,
          subject: card.subject,
          source_note_id: card.source_note_id,
          version: card.version,
        }
      : (initial ?? {
          front: "",
          back: "",
          subject: "通用",
          source_note_id: null,
          version: 0,
        }),
  );
  const [seeds, setSeeds] = useState<MemoryCardSeed[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    inFlight = useRef(false),
    createId = useRef(crypto.randomUUID());
  useEffect(() => {
    dialog.current?.showModal();
    const c = new AbortController();
    void api
      .cardSeeds(c.signal)
      .then((r) => {
        if (!c.signal.aborted) setSeeds(r.items);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  const edit = (change: Partial<MemoryCardWrite>) =>
    setDraft((d) => ({ ...d, ...change }));
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await api.saveCard(card?.id ?? createId.current, draft);
      onSaved();
    } catch (e) {
      setError(studyError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (!inFlight.current) onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="study-dialog study-card-editor"
      aria-labelledby="memory-card-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="memory-card-editor-title">
          {card ? "编辑卡片" : "新建记忆卡"}
        </h2>
        <button aria-label="关闭卡片编辑" disabled={busy} onClick={close}>
          <X size={20} />
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? (
          <p className="study-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="study-card-editor-options">
          <label>
            学科
            <select
              aria-label="卡片学科"
              value={draft.subject}
              disabled={busy}
              onChange={(e) =>
                edit({ subject: e.target.value as MemoryCardWrite["subject"] })
              }
            >
              {subjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {!card && !initial ? (
            <label>
              从课程选取
              <select
                aria-label="课程卡片素材"
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  const s = seeds.find((v) => v.id === e.target.value);
                  if (s)
                    edit({ front: s.front, back: s.back, subject: s.subject });
                }}
              >
                <option value="">选择一个已学考点</option>
                {seeds
                  .filter(
                    (s) =>
                      draft.subject === "通用" || s.subject === draft.subject,
                  )
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.subject} · {s.title}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
        <label>
          正面 · 提问
          <textarea
            aria-label="卡片正面"
            value={draft.front}
            onChange={(e) => edit({ front: e.target.value })}
            maxLength={2000}
            rows={3}
            disabled={busy}
            required
          />
        </label>
        <label>
          背面 · 答案
          <textarea
            aria-label="卡片背面"
            value={draft.back}
            onChange={(e) => edit({ back: e.target.value })}
            maxLength={8000}
            rows={5}
            disabled={busy}
            required
            placeholder="公式可写成 $O(n)$ 或 $$E=mc^2$$"
          />
        </label>
        <button
          type="button"
          className="study-quiet-link"
          aria-expanded={preview}
          onClick={() => setPreview((v) => !v)}
        >
          预览卡片
        </button>
        {preview ? (
          <div className="study-card-preview">
            <CardContent text={draft.front} />
            <hr />
            <CardContent text={draft.back} />
          </div>
        ) : null}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className="study-primary"
            disabled={busy || !draft.front.trim() || !draft.back.trim()}
          >
            {busy ? "正在保存…" : "保存卡片"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
