import type {
  CommunityCircleSummary,
  CommunityPostCreateRequest,
  CommunityPostDetailResponse,
  CommunityPostList,
  CommunityPostSort,
  CommunityPostSummary,
  CommunityTopic,
} from "@xuetu/contracts";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  GraduationCap,
  Heart,
  MessageCircle,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  createCommunityPost,
  createCommunityReply,
  deleteCommunityPost,
  deleteCommunityReply,
  getCommunityCircles,
  getCommunityPost,
  getCommunityPosts,
  setCommunityPostLike,
  updateCommunityPost,
  updateCommunityReply,
} from "../../api/client";

const topicOptions: readonly CommunityTopic[] = [
  "择校交流",
  "备考规划",
  "课程讨论",
  "经验复盘",
];

function requestKey(prefix: string) {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function readableError(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "院校圈暂时无法访问，请稍后重试。";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function useCommunityDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
    )).filter((element) => element.tabIndex !== -1);
    const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")
      ?? focusableElements()[0];

    document.body.style.overflow = "hidden";
    initialFocus?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return dialogRef;
}

function CircleRail({
  circles,
  selectedCircleId,
  onSelect,
}: {
  circles: CommunityCircleSummary[];
  selectedCircleId: string;
  onSelect: (circleId: string) => void;
}) {
  return (
    <aside className="community-circle-rail" aria-label="院校圈列表">
      <div className="community-rail-heading">
        <span className="community-rail-title">选择圈子</span>
        <strong className="community-rail-count">{circles.length} 个</strong>
      </div>
      <div className="community-circle-list">
        {circles.map((circle) => (
          <button
            aria-pressed={selectedCircleId === circle.circle_id}
            className={selectedCircleId === circle.circle_id ? "is-active" : ""}
            data-target={circle.is_my_target ? "true" : "false"}
            key={circle.circle_id}
            onClick={() => onSelect(circle.circle_id)}
            type="button"
          >
            <span className="community-circle-mark" aria-hidden="true">
              {circle.circle_id === "circle_all_408" ? <MessageCircle size={18} /> : <GraduationCap size={19} />}
            </span>
            <span className="community-circle-copy">
              <span className="community-circle-name"><strong>{circle.school_name}</strong></span>
              <span className="community-circle-stats">
                <span><Users aria-hidden="true" size={12} />{circle.member_count}人</span>
                <span><MessageCircle aria-hidden="true" size={12} />{circle.post_count}帖</span>
                {circle.is_my_target ? <em className="community-circle-target" title="我的目标院校">目标</em> : null}
              </span>
            </span>
            <span className="community-circle-selected" aria-hidden="true"><Check size={13} /></span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CommunityPostCard({ post }: { post: CommunityPostSummary }) {
  return (
    <article aria-label={post.title} className="community-post-card">
      <div className="community-post-avatar" aria-hidden="true">{post.author.avatar_label}</div>
      <div className="community-post-content">
        <div className="community-post-meta">
          <strong>{post.author.display_name}</strong>
          <span>{post.circle.school_name}</span>
          <span>{formatTime(post.created_at)}</span>
        </div>
        <Link className="community-post-title" to={`/student/community/${post.post_id}`}>
          {post.title}
        </Link>
        <p>{post.excerpt}</p>
        <footer>
          <span className="community-topic-label">{post.topic}</span>
          <span><Eye aria-hidden="true" size={14} />{post.view_count}</span>
          <span><MessageCircle aria-hidden="true" size={14} />{post.reply_count}</span>
          <span><Heart aria-hidden="true" size={14} />{post.like_count}</span>
        </footer>
      </div>
    </article>
  );
}

function ComposePostDialog({
  circles,
  initialCircleId,
  onClose,
  onCreated,
}: {
  circles: CommunityCircleSummary[];
  initialCircleId: string;
  onClose: () => void;
  onCreated: (post: CommunityPostSummary) => void;
}) {
  const fallbackCircleId = circles[0]?.circle_id ?? "";
  const [circleId, setCircleId] = useState(initialCircleId || fallbackCircleId);
  const [topic, setTopic] = useState<CommunityTopic>("备考规划");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(requestKey("community-post"));
  const dialogRef = useCommunityDialog(onClose);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!circleId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCommunityPost(
        { circle_id: circleId, topic, title, body },
        idempotencyKey.current,
      );
      onCreated(created);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="community-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="community-compose-title"
        aria-modal="true"
        className="community-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>发起新话题</span>
            <h2 id="community-compose-title">发布讨论</h2>
          </div>
          <button aria-label="关闭发布窗口" className="community-icon-button" onClick={onClose} title="关闭" type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <form onSubmit={(event) => { void submit(event); }}>
          <div className="community-compose-fields">
            <label>
              <span>院校圈</span>
              <select aria-label="院校圈" autoComplete="off" data-dialog-initial-focus name="circle_id" onChange={(event) => { setCircleId(event.target.value); idempotencyKey.current = requestKey("community-post"); }} required value={circleId}>
                {circles.map((circle) => (
                  <option key={circle.circle_id} value={circle.circle_id}>{circle.school_name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>话题</span>
              <select aria-label="话题" autoComplete="off" name="topic" onChange={(event) => { setTopic(event.target.value as CommunityTopic); idempotencyKey.current = requestKey("community-post"); }} value={topic}>
                {topicOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>标题</span>
            <input aria-label="标题" autoComplete="off" maxLength={80} minLength={5} name="title" onChange={(event) => { setTitle(event.target.value); idempotencyKey.current = requestKey("community-post"); }} required value={title} />
            <small>{title.length} / 80</small>
          </label>
          <label>
            <span>正文</span>
            <textarea aria-label="正文" autoComplete="off" maxLength={5_000} minLength={10} name="body" onChange={(event) => { setBody(event.target.value); idempotencyKey.current = requestKey("community-post"); }} required rows={8} value={body} />
            <small>{body.length} / 5000</small>
          </label>
          {error ? <p className="community-form-error" role="alert">{error}</p> : null}
          <footer>
            <button className="community-secondary-button" onClick={onClose} type="button">取消</button>
            <button className="community-primary-button" disabled={submitting || !circleId} type="submit">
              <Send aria-hidden="true" size={16} />{submitting ? "正在发布" : "确认发布"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function EditPostDialog({
  detail,
  onClose,
  onSaved,
}: {
  detail: CommunityPostDetailResponse;
  onClose: () => void;
  onSaved: (post: CommunityPostSummary) => void;
}) {
  const [topic, setTopic] = useState(detail.post.topic);
  const [title, setTitle] = useState(detail.post.title);
  const [body, setBody] = useState(detail.post.body);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useCommunityDialog(onClose);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onSaved(await updateCommunityPost(detail.post.post_id, { topic, title, body }));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="community-dialog-backdrop" role="presentation">
      <section aria-labelledby="community-edit-title" aria-modal="true" className="community-dialog" ref={dialogRef} role="dialog">
        <header>
          <div><span>本人内容</span><h2 id="community-edit-title">编辑讨论</h2></div>
          <button aria-label="关闭编辑窗口" className="community-icon-button" onClick={onClose} title="关闭" type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <form onSubmit={(event) => { void submit(event); }}>
          <label>
            <span>话题</span>
            <select aria-label="话题" autoComplete="off" data-dialog-initial-focus name="topic" onChange={(event) => setTopic(event.target.value as CommunityTopic)} value={topic}>
              {topicOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label><span>标题</span><input aria-label="标题" autoComplete="off" maxLength={80} minLength={5} name="title" onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
          <label><span>正文</span><textarea aria-label="正文" autoComplete="off" maxLength={5_000} minLength={10} name="body" onChange={(event) => setBody(event.target.value)} required rows={8} value={body} /></label>
          {error ? <p className="community-form-error" role="alert">{error}</p> : null}
          <footer>
            <button className="community-secondary-button" onClick={onClose} type="button">取消</button>
            <button className="community-primary-button" disabled={submitting} type="submit">{submitting ? "正在保存" : "保存修改"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CommunityPostDetailView({
  detail,
  onReload,
  onDeleted,
  onDetailChange,
  onReplyPageChange,
}: {
  detail: CommunityPostDetailResponse;
  onReload: () => Promise<void>;
  onDeleted: () => void;
  onDetailChange: (detail: CommunityPostDetailResponse) => void;
  onReplyPageChange: (page: number) => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingReplyBody, setEditingReplyBody] = useState("");
  const replyIdempotencyKey = useRef(requestKey("community-reply"));
  const post = detail.post;

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (replying) return;
    setReplying(true);
    setError(null);
    try {
      await createCommunityReply(
        post.post_id,
        { body: replyBody },
        replyIdempotencyKey.current,
      );
      setReplyBody("");
      replyIdempotencyKey.current = requestKey("community-reply");
      const lastReplyPage = Math.max(
        1,
        Math.ceil((detail.reply_total + 1) / detail.reply_page_size),
      );
      if (lastReplyPage === detail.reply_page) await onReload();
      else onReplyPageChange(lastReplyPage);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setReplying(false);
    }
  };

  const setLike = async () => {
    if (likePending) return;
    setLikePending(true);
    setError(null);
    try {
      const state = await setCommunityPostLike(post.post_id, !post.liked_by_me);
      onDetailChange({
        ...detail,
        post: { ...post, liked_by_me: state.liked, like_count: state.like_count },
      });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLikePending(false);
    }
  };

  const removePost = async () => {
    if (!window.confirm("确定删除这篇讨论吗？删除后无法恢复。")) return;
    try {
      await deleteCommunityPost(post.post_id);
      onDeleted();
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  const saveReply = async (replyId: string) => {
    try {
      await updateCommunityReply(replyId, { body: editingReplyBody });
      setEditingReplyId(null);
      await onReload();
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  const removeReply = async (replyId: string) => {
    if (!window.confirm("确定删除这条回复吗？")) return;
    try {
      await deleteCommunityReply(replyId);
      await onReload();
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  return (
    <div className="community-detail">
      <Link className="community-back-link" to="/student/community"><ArrowLeft aria-hidden="true" size={16} />返回讨论列表</Link>
      <article className="community-detail-post">
        <header>
          <div className="community-post-avatar" aria-hidden="true">{post.author.avatar_label}</div>
          <div>
            <div className="community-post-meta">
              <strong>{post.author.display_name}</strong>
              <span>{post.circle.school_name}</span>
              <span>{formatTime(post.created_at)}</span>
            </div>
            <h2>{post.title}</h2>
          </div>
          {post.author.is_self ? (
            <div className="community-owner-actions">
              <button aria-label="编辑这篇讨论" className="community-icon-button" onClick={() => setEditingPost(true)} title="编辑" type="button"><PenLine aria-hidden="true" size={16} /></button>
              <button aria-label="删除这篇讨论" className="community-icon-button danger" onClick={() => { void removePost(); }} title="删除" type="button"><Trash2 aria-hidden="true" size={16} /></button>
            </div>
          ) : null}
        </header>
        <div className="community-detail-body">{post.body}</div>
        <footer>
          <span className="community-topic-label">{post.topic}</span>
          <span><Eye aria-hidden="true" size={14} />{post.view_count}</span>
          <span><MessageCircle aria-hidden="true" size={14} />{post.reply_count}</span>
          <button
            aria-label={post.liked_by_me ? "取消赞同这篇讨论" : "赞同这篇讨论"}
            aria-pressed={post.liked_by_me}
            className={post.liked_by_me ? "community-like-button is-liked" : "community-like-button"}
            disabled={likePending}
            onClick={() => { void setLike(); }}
            title={post.liked_by_me ? "取消赞同" : "赞同"}
            type="button"
          >
            <Heart aria-hidden="true" fill={post.liked_by_me ? "currentColor" : "none"} size={15} />{post.like_count}
          </button>
        </footer>
      </article>

      <section aria-labelledby="community-replies-title" className="community-replies">
        <header><h3 id="community-replies-title">讨论回复</h3><span>{detail.reply_total} 条</span></header>
        {detail.replies.length === 0 ? <p className="community-empty-replies">还没有回复，可以说说你的想法。</p> : (
          <ol>
            {detail.replies.map((reply) => (
              <li key={reply.reply_id}>
                <div className="community-reply-avatar" aria-hidden="true">{reply.author.avatar_label}</div>
                <div>
                  <header>
                    <strong>{reply.author.display_name}</strong>
                    <span>{formatTime(reply.created_at)}</span>
                    {reply.author.is_self ? (
                      <div className="community-owner-actions">
                        <button aria-label="编辑这条回复" className="community-icon-button" onClick={() => { setEditingReplyId(reply.reply_id); setEditingReplyBody(reply.body); }} title="编辑" type="button"><PenLine aria-hidden="true" size={14} /></button>
                        <button aria-label="删除这条回复" className="community-icon-button danger" onClick={() => { void removeReply(reply.reply_id); }} title="删除" type="button"><Trash2 aria-hidden="true" size={14} /></button>
                      </div>
                    ) : null}
                  </header>
                  {editingReplyId === reply.reply_id ? (
                    <div className="community-inline-edit">
                      <textarea aria-label="编辑回复内容" maxLength={1_000} minLength={2} onChange={(event) => setEditingReplyBody(event.target.value)} rows={4} value={editingReplyBody} />
                      <div>
                        <button className="community-secondary-button" onClick={() => setEditingReplyId(null)} type="button">取消</button>
                        <button className="community-primary-button" onClick={() => { void saveReply(reply.reply_id); }} type="button">保存</button>
                      </div>
                    </div>
                  ) : <p>{reply.body}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {detail.reply_total_pages > 1 ? (
        <nav aria-label="回复翻页" className="community-pagination">
          <button
            aria-label="上一页回复"
            disabled={detail.reply_page <= 1}
            onClick={() => onReplyPageChange(Math.max(1, detail.reply_page - 1))}
            title="上一页回复"
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={17} />
          </button>
          <span>回复第 {detail.reply_page} / {detail.reply_total_pages} 页</span>
          <button
            aria-label="下一页回复"
            disabled={detail.reply_page >= detail.reply_total_pages}
            onClick={() => onReplyPageChange(detail.reply_page + 1)}
            title="下一页回复"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </nav>
      ) : null}

      <form className="community-reply-form" onSubmit={(event) => { void submitReply(event); }}>
        <label htmlFor="community-reply-body">回复内容</label>
        <textarea
          autoComplete="off"
          id="community-reply-body"
          maxLength={1_000}
          minLength={2}
          name="reply_body"
          onChange={(event) => {
            setReplyBody(event.target.value);
            replyIdempotencyKey.current = requestKey("community-reply");
          }}
          placeholder="写下你的经验、问题或补充"
          required
          rows={4}
          value={replyBody}
        />
        <div>
          <span>{replyBody.length} / 1000</span>
          <button className="community-primary-button" disabled={replying} type="submit"><Send aria-hidden="true" size={15} />{replying ? "正在发表" : "发表回复"}</button>
        </div>
      </form>
      {error ? <p className="community-form-error" role="alert">{error}</p> : null}

      {editingPost ? (
        <EditPostDialog
          detail={detail}
          onClose={() => setEditingPost(false)}
          onSaved={() => { setEditingPost(false); void onReload(); }}
        />
      ) : null}
    </div>
  );
}

export function CommunityPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [circles, setCircles] = useState<CommunityCircleSummary[]>([]);
  const [currentTargetCircleId, setCurrentTargetCircleId] = useState<string | null>(null);
  const [selectedCircleId, setSelectedCircleId] = useState("");
  const [topic, setTopic] = useState<CommunityTopic | "all">("all");
  const [sort, setSort] = useState<CommunityPostSort>("recent");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [replyPage, setReplyPage] = useState(1);
  const [posts, setPosts] = useState<CommunityPostList | null>(null);
  const [detail, setDetail] = useState<CommunityPostDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  const loadCircles = useCallback(async () => {
    const overview = await getCommunityCircles();
    setCircles(overview.circles);
    setCurrentTargetCircleId(overview.current_target_circle_id);
    setSelectedCircleId((current) => current || overview.current_target_circle_id || overview.circles[0]?.circle_id || "");
  }, []);

  const loadPosts = useCallback(async () => {
    const requestId = ++listRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextPosts = await getCommunityPosts({
        ...(selectedCircleId ? { circle_id: selectedCircleId } : {}),
        ...(topic !== "all" ? { topic } : {}),
        ...(search ? { search } : {}),
        sort,
        page,
        page_size: 12,
      });
      if (requestId === listRequestIdRef.current) {
        const lastPage = Math.max(1, nextPosts.total_pages);
        if (page > lastPage) setPage(lastPage);
        else setPosts(nextPosts);
      }
    } catch (cause) {
      if (requestId === listRequestIdRef.current) setError(readableError(cause));
    } finally {
      if (requestId === listRequestIdRef.current) setLoading(false);
    }
  }, [page, search, selectedCircleId, sort, topic]);

  const loadDetail = useCallback(async () => {
    if (!postId) return;
    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setError(null);
    try {
      const nextDetail = await getCommunityPost(postId, { reply_page: replyPage, reply_page_size: 30 });
      if (requestId === detailRequestIdRef.current) {
        const lastReplyPage = Math.max(1, nextDetail.reply_total_pages);
        if (replyPage > lastReplyPage) setReplyPage(lastReplyPage);
        else {
          setDetail(nextDetail);
          setSelectedCircleId(nextDetail.post.circle.circle_id);
        }
      }
    } catch (cause) {
      if (requestId === detailRequestIdRef.current) {
        setError(readableError(cause));
        setDetail(null);
      }
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false);
    }
  }, [postId, replyPage]);

  useEffect(() => {
    let active = true;
    void loadCircles().catch((cause) => {
      if (active) setError(readableError(cause));
    });
    return () => { active = false; };
  }, [loadCircles]);

  useEffect(() => {
    if (!postId) void loadPosts();
  }, [loadPosts, postId]);

  useEffect(() => {
    if (postId) void loadDetail();
    else {
      detailRequestIdRef.current += 1;
      setReplyPage(1);
      setDetailLoading(false);
      setDetail(null);
    }
  }, [loadDetail, postId]);

  const selectedCircle = useMemo(
    () => circles.find((circle) => circle.circle_id === selectedCircleId) ?? null,
    [circles, selectedCircleId],
  );

  const selectCircle = (circleId: string) => {
    setSelectedCircleId(circleId);
    setPage(1);
    if (postId) navigate("/student/community");
  };

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  return (
    <div className="page-inner community-page" data-visual-system="ochre-serif">
      <header className="community-masthead">
        <div>
          <span className="community-kicker"><MessageCircle aria-hidden="true" size={15} />备考同路人</span>
          <h1>院校圈</h1>
        </div>
        <button className="community-primary-button community-compose-trigger" disabled={circles.length === 0} onClick={() => setComposeOpen(true)} type="button">
          <Plus aria-hidden="true" size={17} />发布讨论
        </button>
      </header>

      <div className="community-workspace">
        <CircleRail circles={circles} onSelect={selectCircle} selectedCircleId={selectedCircleId} />

        <section className="community-main">
          {postId ? (
            detailLoading ? (
              <div aria-live="polite" className="community-state" role="status"><RefreshCw aria-hidden="true" className="is-spinning" size={20} /><p>正在读取讨论…</p></div>
            ) : detail ? (
              <CommunityPostDetailView
                detail={detail}
                onDeleted={() => navigate("/student/community", { replace: true })}
                onDetailChange={setDetail}
                onReload={loadDetail}
                onReplyPageChange={setReplyPage}
              />
            ) : (
              <div className="community-state error" role="alert"><p>{error ?? "这篇讨论不存在。"}</p><button className="community-secondary-button" onClick={() => { void loadDetail(); }} type="button"><RefreshCw aria-hidden="true" size={15} />重试</button></div>
            )
          ) : (
            <>
              <section className="community-list-heading" aria-label="讨论筛选">
                <div>
                  <span>{selectedCircle?.is_my_target ? "我的目标院校" : "当前圈子"}</span>
                  <h2>{selectedCircle?.school_name ?? "全部讨论"}</h2>
                  <p>{selectedCircle?.description ?? "浏览院校圈里的最新讨论"}</p>
                </div>
                <form className="community-search" onSubmit={applySearch}>
                  <Search aria-hidden="true" size={16} />
                  <label className="sr-only" htmlFor="community-search-input">搜索讨论</label>
                  <input autoComplete="off" id="community-search-input" maxLength={80} name="community_search" onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索标题或正文…" value={searchDraft} />
                  <button aria-label="搜索" title="搜索" type="submit"><Search aria-hidden="true" size={15} /></button>
                </form>
              </section>

              <div className="community-filter-bar">
                <div aria-label="排序方式" className="community-sort-tabs" role="group">
                  {([[
                    "recent", "最新",
                  ], ["popular", "热门"], ["mine", "我的"]] as const).map(([value, label]) => (
                    <button aria-pressed={sort === value} className={sort === value ? "is-active" : ""} key={value} onClick={() => { setSort(value); setPage(1); }} type="button">{label}</button>
                  ))}
                </div>
                <label className="community-topic-filter">
                  <span>话题</span>
                  <select onChange={(event) => { setTopic(event.target.value as CommunityTopic | "all"); setPage(1); }} value={topic}>
                    <option value="all">全部话题</option>
                    {topicOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>

              {loading ? (
                <div aria-live="polite" className="community-state" role="status"><RefreshCw aria-hidden="true" className="is-spinning" size={20} /><p>正在读取讨论…</p></div>
              ) : error ? (
                <div className="community-state error" role="alert"><p>{error}</p><button className="community-secondary-button" onClick={() => { void loadPosts(); }} type="button"><RefreshCw aria-hidden="true" size={15} />重试</button></div>
              ) : posts?.items.length ? (
                <section aria-label="讨论列表" className="community-post-list">
                  {posts.items.map((post) => <CommunityPostCard key={post.post_id} post={post} />)}
                </section>
              ) : (
                <div className="community-state empty"><MessageCircle aria-hidden="true" size={23} /><h3>还没有符合条件的讨论</h3><p>换一个筛选条件，或者发起这个圈子的第一篇讨论。</p></div>
              )}

              {posts && posts.total_pages > 1 ? (
                <nav aria-label="讨论翻页" className="community-pagination">
                  <button aria-label="上一页" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} title="上一页" type="button"><ChevronLeft aria-hidden="true" size={17} /></button>
                  <span>第 {page} / {posts.total_pages} 页</span>
                  <button aria-label="下一页" disabled={page >= posts.total_pages} onClick={() => setPage((current) => current + 1)} title="下一页" type="button"><ChevronRight aria-hidden="true" size={17} /></button>
                </nav>
              ) : null}
            </>
          )}
        </section>

        <aside className="community-context" aria-label="当前圈子概况">
          <span>{selectedCircle?.is_my_target ? "目标已匹配" : "圈子概况"}</span>
          <h2>{selectedCircle?.school_name ?? "院校圈"}</h2>
          <p>{selectedCircle?.description ?? "选择左侧院校圈查看讨论。"}</p>
          <dl>
            <div><dt>同目标成员</dt><dd>{selectedCircle?.member_count ?? 0}</dd></div>
            <div><dt>圈内讨论</dt><dd>{selectedCircle?.post_count ?? 0}</dd></div>
          </dl>
          {currentTargetCircleId && selectedCircleId !== currentTargetCircleId ? (
            <button className="community-target-return" onClick={() => selectCircle(currentTargetCircleId)} type="button">回到我的目标院校</button>
          ) : null}
          <div className="community-conduct">
            <Clock3 aria-hidden="true" size={16} />
            <p>分享自己的备考过程；涉及招生政策和分数线时，以院校官网最新公告为准。</p>
          </div>
        </aside>
      </div>

      {composeOpen ? (
        <ComposePostDialog
          circles={circles}
          initialCircleId={selectedCircleId || currentTargetCircleId || ""}
          onClose={() => setComposeOpen(false)}
          onCreated={(created) => {
            setComposeOpen(false);
            setSelectedCircleId(created.circle.circle_id);
            setTopic("all");
            setSort("recent");
            setSearchDraft("");
            setSearch("");
            setPage(1);
            void Promise.all([loadCircles(), loadPosts()]);
          }}
        />
      ) : null}
    </div>
  );
}
