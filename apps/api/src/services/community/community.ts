import type {
  CommunityCircleOverview,
  CommunityDeleteResult,
  CommunityLikeState,
  CommunityPostCreateRequest,
  CommunityPostDetailResponse,
  CommunityPostList,
  CommunityPostListQuery,
  CommunityPostSummary,
  CommunityPostUpdateRequest,
  CommunityReply,
  CommunityReplyCreateRequest,
  CommunityReplyListQuery,
  CommunityReplyUpdateRequest,
} from "@xuetu/contracts";

export interface CommunityService {
  listCircles(userId: string): Promise<CommunityCircleOverview>;
  listPosts(userId: string, query: CommunityPostListQuery): Promise<CommunityPostList>;
  getPost(
    userId: string,
    postId: string,
    query: CommunityReplyListQuery,
  ): Promise<CommunityPostDetailResponse>;
  createPost(
    userId: string,
    input: CommunityPostCreateRequest,
    idempotencyKey: string,
  ): Promise<CommunityPostSummary>;
  updatePost(
    userId: string,
    postId: string,
    input: CommunityPostUpdateRequest,
  ): Promise<CommunityPostSummary>;
  deletePost(userId: string, postId: string): Promise<CommunityDeleteResult>;
  createReply(
    userId: string,
    postId: string,
    input: CommunityReplyCreateRequest,
    idempotencyKey: string,
  ): Promise<CommunityReply>;
  updateReply(
    userId: string,
    replyId: string,
    input: CommunityReplyUpdateRequest,
  ): Promise<CommunityReply>;
  deleteReply(userId: string, replyId: string): Promise<CommunityDeleteResult>;
  setPostLike(userId: string, postId: string, liked: boolean): Promise<CommunityLikeState>;
}

export class CommunityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409 | 429,
  ) {
    super(message);
    this.name = "CommunityError";
  }
}
