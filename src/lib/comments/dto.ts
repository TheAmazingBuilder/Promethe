/**
 * Comment DTOs - owner-only trade comments (client-safe, no server imports).
 *
 * The Mentors module was removed on 25 Nov 2026 (user decision): mentors
 * used to be the only other authors, and @mentions only existed to notify
 * them. The thread is now the owner's personal annotation on a trade, so
 * there is no handle, no mention list and no read marker in the payload.
 */

/** Comment author - display name only, never the email. */
export interface CommentAuthorDTO {
  id: string;
  displayName: string;
  isOwner: boolean;
}

export interface TradeCommentDTO {
  id: string;
  tradeId: string;
  parentId: string | null;
  author: CommentAuthorDTO;
  /** Restricted markdown (rendered client-side, raw HTML escaped). */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface CommentsPayloadDTO {
  comments: TradeCommentDTO[];
  canComment: boolean;
}
