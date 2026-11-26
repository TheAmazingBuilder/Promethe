/**
 * Trade comments (server-only) - owner-only notes on the owner's own trades.
 *
 * The Mentors module was removed on 25 Nov 2026 (user decision). Mentors
 * used to be the only other authors, @mentions only existed to notify them,
 * and the unread badge only counted comments by others. With mentors gone,
 * the thread is the owner's personal annotation on a trade: create, edit
 * and delete their own comments, one reply level, soft-delete tombstone
 * when a comment has replies.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { AccessDeniedError } from "@/lib/access";
import type {
  CommentAuthorDTO,
  CommentsPayloadDTO,
  TradeCommentDTO,
} from "@/lib/comments/dto";
import type { CommentCreateInput, CommentEditInput } from "@/lib/validations/comments";

export class CommentValidationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "CommentValidationError";
    this.code = code;
    this.status = status;
  }
}

interface TradeRef {
  id: string;
  userId: string;
}

async function findTrade(tradeId: string): Promise<TradeRef | null> {
  return db.trade.findUnique({
    where: { id: tradeId },
    select: { id: true, userId: true },
  });
}

/** Throws 404 when the trade is missing, 403 when it is not the viewer's. */
async function requireOwnTrade(viewerId: string, tradeId: string): Promise<TradeRef> {
  const trade = await findTrade(tradeId);
  if (!trade) throw new CommentValidationError("TRADE_NOT_FOUND", "Trade not found.", 404);
  if (trade.userId !== viewerId) throw new AccessDeniedError();
  return trade;
}

// ── read ─────────────────────────────────────────────────────────────────────

const AUTHOR_INCLUDE = { author: { include: { profile: true } } } as const;
type CommentRow = Prisma.TradeCommentGetPayload<{ include: typeof AUTHOR_INCLUDE }>;

function toCommentDTO(row: CommentRow, ownerId: string): TradeCommentDTO {
  return {
    id: row.id,
    tradeId: row.tradeId,
    parentId: row.parentId,
    author: {
      id: row.authorId,
      displayName: row.author.profile?.displayName || "User",
      isOwner: row.authorId === ownerId,
    },
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export async function listComments(
  viewerId: string,
  tradeId: string
): Promise<CommentsPayloadDTO> {
  const trade = await requireOwnTrade(viewerId, tradeId);
  const rows = await db.tradeComment.findMany({
    where: { tradeId },
    include: AUTHOR_INCLUDE,
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return {
    comments: rows.map((row) => toCommentDTO(row, trade.userId)),
    canComment: true,
  };
}

// ── create ───────────────────────────────────────────────────────────────────

export async function createComment(
  viewerId: string,
  tradeId: string,
  input: CommentCreateInput
): Promise<TradeCommentDTO> {
  const trade = await requireOwnTrade(viewerId, tradeId);

  // Rate limit: 20 comments per author per 10 minutes.
  const rl = await consumeRateLimit(`comment:${viewerId}`, 20, 10 * 60 * 1000);
  if (!rl.allowed) {
    throw new CommentValidationError(
      "COMMENT_RATE_LIMITED",
      "Too many comments – please wait a moment.",
      429
    );
  }

  // Parent validation: same trade, not deleted, one level of threading.
  let parent: {
    id: string;
    authorId: string;
    parentId: string | null;
    tradeId: string;
    deletedAt: Date | null;
  } | null = null;
  if (input.parentId) {
    parent = await db.tradeComment.findUnique({
      where: { id: input.parentId },
      select: { id: true, authorId: true, parentId: true, tradeId: true, deletedAt: true },
    });
    if (!parent || parent.tradeId !== tradeId || parent.deletedAt) {
      throw new CommentValidationError("PARENT_INVALID", "Invalid parent comment.");
    }
    if (parent.parentId) {
      throw new CommentValidationError(
        "PARENT_INVALID",
        "Only one reply level – reply to the original comment."
      );
    }
  }

  const created = await db.tradeComment.create({
    data: {
      tradeId,
      ownerId: trade.userId,
      authorId: viewerId,
      parentId: parent?.id ?? null,
      body: input.body,
    },
    include: AUTHOR_INCLUDE,
  });

  return toCommentDTO(created, trade.userId);
}

// ── edit / delete ────────────────────────────────────────────────────────────

export async function editComment(
  viewerId: string,
  commentId: string,
  input: CommentEditInput,
  expectedTradeId?: string
): Promise<TradeCommentDTO> {
  const row = await db.tradeComment.findUnique({
    where: { id: commentId },
    include: AUTHOR_INCLUDE,
  });
  if (!row || (expectedTradeId !== undefined && row.tradeId !== expectedTradeId)) {
    throw new CommentValidationError("COMMENT_NOT_FOUND", "Comment not found.", 404);
  }
  if (row.deletedAt) {
    throw new CommentValidationError("COMMENT_DELETED", "This comment has been deleted.");
  }
  if (row.authorId !== viewerId) {
    throw new AccessDeniedError("Only the author can edit their comment.");
  }

  const updated = await db.tradeComment.update({
    where: { id: commentId },
    data: { body: input.body, editedAt: new Date() },
    include: AUTHOR_INCLUDE,
  });

  return toCommentDTO(updated, row.ownerId);
}

export async function deleteComment(
  viewerId: string,
  commentId: string,
  expectedTradeId?: string
): Promise<void> {
  const row = await db.tradeComment.findUnique({ where: { id: commentId } });
  if (!row || (expectedTradeId !== undefined && row.tradeId !== expectedTradeId)) {
    throw new CommentValidationError("COMMENT_NOT_FOUND", "Comment not found.", 404);
  }

  const isAuthor = row.authorId === viewerId;
  const isOwner = row.ownerId === viewerId;
  if (!isAuthor && !isOwner) {
    throw new AccessDeniedError("Only the author or the journal owner can delete this comment.");
  }
  if (row.deletedAt) return;

  const hasReplies = await db.tradeComment.count({
    where: { parentId: commentId },
  });
  if (hasReplies > 0) {
    // Tombstone: the thread keeps its shape, the content is gone.
    await db.tradeComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), body: "" },
    });
  } else {
    await db.tradeComment.delete({ where: { id: commentId } });
  }
}

export type { CommentAuthorDTO };
