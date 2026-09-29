import {
  ArrowLeft,
  ArrowRight,
  FolderPlus,
  Layers3,
  Map,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useSearchParams } from "react-router-dom";
import type { StudyCollection, StudyQuestion } from "@xuetu/contracts";
import { studyMapQuerySchema } from "@xuetu/contracts";
import { studyLibraryApi as api } from "./study-library-api";
import "./study-library.css";
import { useAuth } from "../auth/auth-context";
import { readStudyQueue } from "./study-queue-storage";

export const studyError = (error: unknown) =>
  error instanceof TypeError ? "网络连接中断，请重试。" : error instanceof Error ? error.message : "暂时无法完成，请重试。";
export function StudyToolsNav() {
  return (
    <nav className="study-tools-nav" aria-label="我的复习工具">
      <NavLink to="/student/question-map">
        <Map size={17} />
        题目地图
      </NavLink>
      <NavLink to="/student/collections">
        <FolderPlus size={17} />
        专题题本
      </NavLink>
      <NavLink to="/student/memory-cards">
        <Layers3 size={17} />
        每日记忆卡
      </NavLink>
    </nav>
  );
}
export function studyQueueHref(
  q: StudyQuestion,
  kind: "collection" | "map",
  value: string,
) {
  const url = new URL(q.href, "http://local");
  url.searchParams.set(`library_${kind}`, value);
  return `${url.pathname}${url.search}`;
}
export function StudyQueueNav({ questionId }: { questionId?: string }) {
  const { account } = useAuth();
  const owner = account?.user_id;
  const [params] = useSearchParams();
  const collection = params.get("library_collection"),
    map = params.get("library_map");
  const [questions, setQuestions] = useState<StudyQuestion[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!collection && !map) {
      setQuestions([]);
      return;
    }
    const controller = new AbortController();
    setError("");
    setQuestions([]);
    try {
      const query = map ? studyMapQuerySchema.parse(JSON.parse(map)) : null;
      const ids = owner && map ? readStudyQueue(owner, map) : null;
      const promise = collection
        ? api.collection(collection, controller.signal).then((r) => r.questions)
        : api
            .map(
              { ...query!, ...(ids ? { status: "all" as const } : {}) },
              controller.signal,
            )
            .then((r) =>
              ids
                ? ids.flatMap((id) => {
                    const q = r.items.find((item) => item.id === id);
                    return q ? [q] : [];
                  })
                : r.items,
            );
      void promise
        .then((q) => {
          if (!controller.signal.aborted) setQuestions(q);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(studyError(e));
        });
    } catch {
      setError("练习队列无效，请返回重新选择。");
    }
    return () => controller.abort();
  }, [collection, map, owner]);
  if (!collection && !map) return null;
  const index = questions.findIndex((q) => q.id === questionId),
    kind = collection ? "collection" : "map",
    value = collection ?? map!;
  const link = (q: StudyQuestion) => studyQueueHref(q, kind, value);
  let back = "/student/question-map";
  try {
    if (map)
      back += `?${new URLSearchParams(
        Object.entries(studyMapQuerySchema.parse(JSON.parse(map)))
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      )}`;
  } catch {
    /* Invalid queue gets the unfiltered map entry. */
  }
  return (
    <aside className="study-queue-nav" aria-label="专题练习队列">
      <Link
        to={
          collection
            ? `/student/collections?collection=${encodeURIComponent(collection)}`
            : back
        }
      >
        <ArrowLeft size={16} />
        返回{collection ? "题本" : "地图"}
      </Link>
      <strong>
        {error ||
          (index >= 0
            ? `本组第 ${index + 1} / ${questions.length} 题`
            : "正在定位本题")}
      </strong>
      <div>
        {questions[index - 1] ? (
          <Link to={link(questions[index - 1]!)}>上一题</Link>
        ) : null}
        {questions[index + 1] ? (
          <Link className="study-primary" to={link(questions[index + 1]!)}>
            本组下一题
            <ArrowRight size={15} />
          </Link>
        ) : index >= 0 ? (
          <span>已到本组最后一题</span>
        ) : null}
      </div>
    </aside>
  );
}
export function CollectionPicker({ questionId }: { questionId: string }) {
  const [open, setOpen] = useState(false),
    [collections, setCollections] = useState<StudyCollection[]>([]),
    [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [loading, setLoading] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const c = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      api.collections(c.signal),
      api.memberships(questionId, c.signal),
    ])
      .then(([a, b]) => {
        if (!c.signal.aborted) {
          setCollections(a.items);
          setIds(b.ids);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(studyError(e));
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [open, questionId]);
  function close() {
    if (inFlight.current) return;
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }
  async function change(id: string, included: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await api.setMembership(id, questionId, included);
      setIds((current) =>
        included
          ? [...new Set([...current, id])]
          : current.filter((v) => v !== id),
      );
    } catch (e) {
      setError(studyError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (!name.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const { collection } = await api.saveCollection(crypto.randomUUID(), {
        name: name.trim(),
        version: 0,
      });
      setCollections((c) => [...c, collection]);
      setName("");
      await api.setMembership(collection.id, questionId, true);
      setIds((c) => [...c, collection.id]);
    } catch (e) {
      setError(studyError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        <FolderPlus size={16} />
        加入题本
      </button>
      {open
        ? createPortal(
            <dialog
              ref={dialog}
              className="study-dialog"
              onCancel={(e) => {
                e.preventDefault();
                close();
              }}
              aria-labelledby="collection-picker-title"
            >
              <header>
                <h2 id="collection-picker-title">收进专题题本</h2>
                <button
                  type="button"
                  disabled={busy}
                  onClick={close}
                  aria-label="关闭题本选择"
                >
                  <X size={20} />
                </button>
              </header>
              {error ? (
                <p role="alert" className="study-error">
                  {error}
                </p>
              ) : null}
              <div className="study-picker-list">
                {loading ? (
                  <p role="status">正在读取题本…</p>
                ) : (
                  collections.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={ids.includes(c.id)}
                        disabled={busy}
                        onChange={(e) => void change(c.id, e.target.checked)}
                      />
                      <span>{c.name}</span>
                    </label>
                  ))
                )}
                {!loading && !collections.length ? (
                  <p>建一个题本，把同类题收在一起。</p>
                ) : null}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
                className="study-inline-form"
              >
                <input
                  aria-label="新题本名称"
                  placeholder="例如：Cache 地址拆分"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  disabled={busy}
                />
                <button
                  className="study-primary"
                  disabled={busy || loading || !name.trim()}
                >
                  新建并加入
                </button>
              </form>
              <footer>
                <Link to="/student/collections" onClick={close}>
                  管理我的题本
                </Link>
                <button
                  className="study-primary"
                  disabled={busy}
                  onClick={close}
                >
                  完成
                </button>
              </footer>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
