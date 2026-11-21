/**
 * v3 Phase 5 — Comments & mentions on trades (server-only).
 *
 * The ONLY place a mentor can write: TradeComment rows authored under their
 * own id. Every mutation re-verifies access; mentions are limited to people
 * who CURRENTLY have access to that trade (owner + scoped active mentors) —
 * validated server-side, impossible to mention anyone else.
 *
 * Notifications (never to the author):
 *  - COMMENT_NEW  → the trade owner (debounced: one per trade per 10 min)
 *  - COMMENT_REPLY → the parent comment's author
 *  - MENTION       → each mentioned user
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  AccessDeniedError,
  canAccessTrade,
  mentorContext,
  ownerContext,
  type AccessContext,
  type AccessScope,
} from "@/lib/access";
import { notifyInApp } from "@/server/notifications";
import { mentorTradeWhere, requireMentorContext } from "@/server/mentors";
import type {
  CommentAuthorDTO,
  CommentsPayloadDTO,
  MentionableUserDTO,
  TradeCommentDTO,
} from "@/lib/mentor/dto";
import type { CommentCreateInput, CommentEditInput } from "@/lib/validations/mentor";

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

/** Mentions are @handle tokens, matching the Profile.handle charset. The @
 *  must NOT be preceded by a word character or a dot (emails stay inert). */
export function parseMentionHandles(body: string): string[] {
  const matches =
    body.match(/(?:^|[^a-zA-Z0-9_@.])@([a-zA-Z0-9_]{3,24})(?![a-zA-Z0-9_])/g) ?? [];
  const handles = new Set<string>();
  for (const match of matches) {
    const at = match.lastIndexOf("@");
    if (at >= 0) handles.add(match.slice(at + 1).toLowerCase());
  }
  return [...handles];
}

// ── authorization ────────────────────────────────────────────────────────────

interface TradeRef {
  id: string;
  userId: string;
  accountId: string;
  strategyId: string | null;
}

async function findTrade(tradeId: string): Promise<TradeRef | null> {
  return db.trade.findUnique({
    where: { id: tradeId },
    select: { id: true, userId: true, accountId: true, strategyId: true },
  });
}

/**
 * Resolves the viewer's relationship to the trade: OWNER context, a mentor
 * AccessContext (when a live access row covers this trade), or null.
 */
async function resolveViewerContext(
  viewerId: string,
  trade: TradeRef
): Promise<AccessContext | null> {
  if (trade.userId === viewerId) {
    return ownerContext(viewerId);
  }
  try {
    const ctx = await requireMentorContext(viewerId, trade.userId);
    if (!canAccessTrade(ctx, trade.accountId, trade.strategyId)) return null;
    return ctx;
  } catch {
    return null;
  }
}

/** Everyone who currently has access to this trade (mention candidates). */
async function mentionableFor(trade: TradeRef): Promise<{
  users: { id: string; handle: string | null; displayName: string; isOwner: boolean }[];
  byHandle: Map<string, { id: string; handle: string | null }>;
}> {
  const owner = await db.user.findUnique({
    where: { id: trade.userId },
    include: { profile: true },
  });
  const users: {
    id: string;
    handle: string | null;
    displayName: string;
    isOwner: boolean;
  }[] = [];
  if (owner?.profile) {
    users.push({
      id: owner.id,
      handle: owner.profile.handle,
      displayName: owner.profile.publicDisplayName || owner.profile.displayName,
      isOwner: true,
    });
  }

  const accesses = await db.mentorAccess.findMany({
    where: {
      ownerId: trade.userId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { mentor: { include: { profile: true } } },
  });
  for (const access of accesses) {
    const scope: AccessScope = {
      accountIds:
        access.accountScope === "ALL"
          ? "ALL"
          : (JSON.parse(access.accountIdsJson || "[]") as string[]),
      strategyIds:
        access.strategyScope === "ALL"
          ? "ALL"
          : (JSON.parse(access.strategyIdsJson || "[]") as string[]),
      canViewAmounts: access.canViewAmounts,
      canViewJournal: access.canViewJournal,
      canViewScreenshots: access.canViewScreenshots,
      canViewAnalytics: access.canViewAnalytics,
      canComment: access.canComment,
    };
    const ctx = mentorContext(access.mentorId, trade.userId, scope);
    if (!canAccessTrade(ctx, trade.accountId, trade.strategyId)) continue;
    const profile = access.mentor.profile;
    users.push({
      id: access.mentorId,
      handle: profile?.handle ?? null,
      displayName: profile?.publicDisplayName || profile?.displayName || "Mentor",
      isOwner: false,
    });
  }

  const byHandle = new Map<string, { id: string; handle: string | null }>();
  for (const user of users) {
    if (user.handle) byHandle.set(user.handle, user);
  }
  return { users, byHandle };
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
      handle: row.author.profile?.handle ?? null,
      displayName:
        row.author.profile?.publicDisplayName ||
        row.author.profile?.displayName ||
        "User",
      isOwner: row.authorId === ownerId,
    },
    body: row.deletedAt ? "" : row.body,
    mentions: [], // filled by caller (bulk query below)
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export async function listComments(
  viewerId: string,
  tradeId: string
): Promise<CommentsPayloadDTO> {
  const trade = await findTrade(tradeId);
  if (!trade) throw new CommentValidationError("TRADE_NOT_FOUND", "Trade not found.", 404);
  const ctx = await resolveViewerContext(viewerId, trade);
  if (!ctx) throw new AccessDeniedError();

  const [rows, readState, mentionable] = await Promise.all([
    db.tradeComment.findMany({
      where: { tradeId },
      include: AUTHOR_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    db.commentReadState.findUnique({
      where: { userId_tradeId: { userId: viewerId, tradeId } },
    }),
    mentionableFor(trade),
  ]);

  // Mentions for the fetched comments (single bulk query).
  const mentionRows = rows.length
    ? await db.commentMention.findMany({
        where: { commentId: { in: rows.map((r) => r.id) } },
        select: { commentId: true, mentionedUserId: true },
      })
    : [];

  const comments = rows.map((row) => ({
    ...toCommentDTO(row, trade.userId),
    mentions: mentionRows.filter((m) => m.commentId === row.id).map((m) => m.mentionedUserId),
  }));

  return {
    comments,
    mentionable: mentionable.users as MentionableUserDTO[],
    canComment: ctx.role === "OWNER" || ctx.scope.canComment,
    lastReadAt: readState?.lastReadAt.toISOString() ?? null,
  };
}

// ── create ───────────────────────────────────────────────────────────────────

export async function createComment(
  viewerId: string,
  tradeId: string,
  input: CommentCreateInput
): Promise<TradeCommentDTO> {
  const trade = await findTrade(tradeId);
  if (!trade) throw new CommentValidationError("TRADE_NOT_FOUND", "Trade not found.", 404);
  const ctx = await resolveViewerContext(viewerId, trade);
  if (!ctx) throw new AccessDeniedError();
  if (ctx.role === "MENTOR" && !ctx.scope.canComment) {
    throw new AccessDeniedError("You do not have permission to comment on this journal.");
  }

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

  // Mentions: every @handle must resolve to someone with CURRENT access.
  const handles = parseMentionHandles(input.body);
  const { byHandle } = await mentionableFor(trade);
  const invalid = handles.filter((h) => !byHandle.has(h));
  if (invalid.length) {
    throw new CommentValidationError(
      "MENTION_INVALID",
      `Mention not possible: @${invalid[0]} does not have access to this trade.`
    );
  }
  const mentionedUsers = handles
    .map((h) => byHandle.get(h)!)
    .filter((u) => u.id !== viewerId);

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
  if (mentionedUsers.length) {
    await db.commentMention.createMany({
      data: mentionedUsers.map((u) => ({ commentId: created.id, mentionedUserId: u.id })),
    });
  }

  // The author has obviously read their own comment.
  await db.commentReadState.upsert({
    where: { userId_tradeId: { userId: viewerId, tradeId } },
    create: { userId: viewerId, tradeId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  await dispatchNotifications({
    ctx,
    trade,
    commentId: created.id,
    parentAuthorId: parent?.authorId ?? null,
    mentionedUsers,
  });

  return {
    ...toCommentDTO(created, trade.userId),
    mentions: mentionedUsers.map((u) => u.id),
  };
}

/** Deep links are role-aware: owners land on /trades, mentors on /mentor. */
function tradeUrlForOwner(tradeId: string): string {
  return `/trades/${tradeId}`;
}

function tradeUrlForMentor(ownerId: string, tradeId: string): string {
  return `/mentor/${ownerId}/trades/${tradeId}`;
}

async function dispatchNotifications(params: {
  ctx: AccessContext;
  trade: TradeRef;
  commentId: string;
  parentAuthorId: string | null;
  mentionedUsers: { id: string }[];
}): Promise<void> {
  const { ctx, trade, parentAuthorId, mentionedUsers } = params;

  // COMMENT_NEW → the owner (unless they wrote it). Debounced per trade.
  if (ctx.role === "MENTOR") {
    await notifyInApp({
      userId: trade.userId,
      type: "COMMENT_NEW",
      title: "New comment",
      body: "A mentor commented on one of your trades.",
      url: tradeUrlForOwner(trade.id),
      dedupeWithinMs: 10 * 60 * 1000,
    });
  }

  // COMMENT_REPLY → the parent's author (if someone else).
  if (parentAuthorId && parentAuthorId !== ctx.viewerId) {
    const recipientIsOwner = parentAuthorId === trade.userId;
    await notifyInApp({
      userId: parentAuthorId,
      type: "COMMENT_REPLY",
      title: "Reply to your comment",
      body: "Someone replied to your comment.",
      url: recipientIsOwner
        ? tradeUrlForOwner(trade.id)
        : tradeUrlForMentor(trade.userId, trade.id),
      dedupeWithinMs: 10 * 60 * 1000,
    });
  }

  // MENTION → each mentioned user (author never mentions themselves — filtered).
  for (const user of mentionedUsers) {
    const recipientIsOwner = user.id === trade.userId;
    await notifyInApp({
      userId: user.id,
      type: "MENTION",
      title: "You were mentioned",
      body: "You were mentioned in a trade comment.",
      url: recipientIsOwner
        ? tradeUrlForOwner(trade.id)
        : tradeUrlForMentor(trade.userId, trade.id),
      dedupeWithinMs: 10 * 60 * 1000,
    });
  }
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

  // Re-validate mentions after the edit.
  const trade = await findTrade(row.tradeId);
  if (!trade) throw new CommentValidationError("TRADE_NOT_FOUND", "Trade not found.", 404);
  const handles = parseMentionHandles(input.body);
  const { byHandle } = await mentionableFor(trade);
  const invalid = handles.filter((h) => !byHandle.has(h));
  if (invalid.length) {
    throw new CommentValidationError(
      "MENTION_INVALID",
      `Mention not possible: @${invalid[0]} does not have access to this trade.`
    );
  }
  const mentionedUsers = handles.map((h) => byHandle.get(h)!).filter((u) => u.id !== viewerId);

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.tradeComment.update({
      where: { id: commentId },
      data: { body: input.body, editedAt: new Date() },
      include: AUTHOR_INCLUDE,
    });
    await tx.commentMention.deleteMany({ where: { commentId } });
    if (mentionedUsers.length) {
      await tx.commentMention.createMany({
        data: mentionedUsers.map((u) => ({ commentId, mentionedUserId: u.id })),
      });
    }
    return next;
  });

  return {
    ...toCommentDTO(updated, row.ownerId),
    mentions: mentionedUsers.map((u) => u.id),
  };
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
    await db.commentMention.deleteMany({ where: { commentId } });
  } else {
    await db.$transaction(async (tx) => {
      await tx.commentMention.deleteMany({ where: { commentId } });
      await tx.tradeComment.delete({ where: { id: commentId } });
    });
  }
}

// ── read states & badges ─────────────────────────────────────────────────────

export async function markTradeRead(viewerId: string, tradeId: string): Promise<void> {
  const trade = await findTrade(tradeId);
  if (!trade) throw new CommentValidationError("TRADE_NOT_FOUND", "Trade not found.", 404);
  const ctx = await resolveViewerContext(viewerId, trade);
  if (!ctx) throw new AccessDeniedError();

  await db.commentReadState.upsert({
    where: { userId_tradeId: { userId: viewerId, tradeId } },
    create: { userId: viewerId, tradeId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

/**
 * Unread comment badge for the OWNER: comments by others on my trades newer
 * than my last read of that trade. Bounded (recent 500 trades / 1000 comments).
 */
export async function unreadCommentCount(viewerId: string): Promise<number> {
  const trades = await db.trade.findMany({
    where: { userId: viewerId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const ids = trades.map((t) => t.id);
  if (!ids.length) return 0;

  const [states, comments] = await Promise.all([
    db.commentReadState.findMany({
      where: { userId: viewerId, tradeId: { in: ids } },
      select: { tradeId: true, lastReadAt: true },
    }),
    db.tradeComment.findMany({
      where: { tradeId: { in: ids }, authorId: { not: viewerId }, deletedAt: null },
      select: { tradeId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);
  const lastReadByTrade = new Map(states.map((s) => [s.tradeId, s.lastReadAt.getTime()]));
  let unread = 0;
  for (const comment of comments) {
    const lastRead = lastReadByTrade.get(comment.tradeId) ?? 0;
    if (comment.createdAt.getTime() > lastRead) unread += 1;
  }
  return unread;
}

/** Mentee-space helper: unread badge per mentee, on scoped trades only. */
export async function unreadCommentsForOwner(
  mentorId: string,
  ctx: AccessContext
): Promise<number> {
  const trades = await db.trade.findMany({
    where: mentorTradeWhere(ctx),
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const ids = trades.map((t) => t.id);
  if (!ids.length) return 0;

  const [states, comments] = await Promise.all([
    db.commentReadState.findMany({
      where: { userId: mentorId, tradeId: { in: ids } },
      select: { tradeId: true, lastReadAt: true },
    }),
    db.tradeComment.findMany({
      where: { tradeId: { in: ids }, authorId: { not: mentorId }, deletedAt: null },
      select: { tradeId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);
  const lastReadByTrade = new Map(states.map((s) => [s.tradeId, s.lastReadAt.getTime()]));
  let unread = 0;
  for (const comment of comments) {
    const lastRead = lastReadByTrade.get(comment.tradeId) ?? 0;
    if (comment.createdAt.getTime() > lastRead) unread += 1;
  }
  return unread;
}

/** Mentors currently watching the owner's journal - count of live accesses. */
export async function watchingMentorsCount(ownerId: string): Promise<number> {
  return db.mentorAccess.count({
    where: {
      ownerId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

export type { CommentAuthorDTO };
