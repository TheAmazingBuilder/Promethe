/**
 * v3 Phase 5 — client-safe mentor & comment DTOs.
 * No server imports here: this module is bundled for the client.
 */

/** Mirror of the MentorAccess permission columns (see validations/mentor.ts). */
export interface MentorPermissionsDTO {
  accountScope: "ALL" | "LIST";
  accountIds: string[];
  strategyScope: "ALL" | "LIST";
  strategyIds: string[];
  canViewAmounts: boolean;
  canViewJournal: boolean;
  canViewScreenshots: boolean;
  canViewAnalytics: boolean;
  canComment: boolean;
  expiresAt: string | null;
}

/** Owner-side: one granted access row. */
export interface MentorAccessDTO {
  id: string;
  mentorId: string;
  mentorHandle: string | null;
  mentorDisplayName: string;
  status: "ACTIVE" | "PAUSED" | "REVOKED";
  permissions: MentorPermissionsDTO;
  createdAt: string;
  lastViewedAt: string | null;
}

/** Owner-side: one pending/finished invitation. */
export interface MentorInvitationDTO {
  id: string;
  inviteeEmail: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "REVOKED";
  permissions: MentorPermissionsDTO;
  createdAt: string;
  expiresAt: string;
}

/** Owner-side aggregated access log (privacy transparency). */
export interface MentorAccessLogDTO {
  mentorHandle: string | null;
  mentorDisplayName: string;
  resourceType: string;
  day: string;
  viewCount: number;
}

/** Mentor-side: one mentee card in /mentor. */
export interface MenteeSummaryDTO {
  ownerId: string;
  ownerHandle: string | null;
  ownerDisplayName: string;
  permissions: MentorPermissionsDTO;
  lastViewedAt: string | null;
  newTradesSince: number;
  unreviewedCount: number;
  unreadComments: number;
}

/** Mentor-side: received invitation. */
export interface ReceivedInvitationDTO {
  id: string;
  ownerHandle: string | null;
  ownerDisplayName: string;
  permissions: MentorPermissionsDTO;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "REVOKED";
  createdAt: string;
  expiresAt: string;
}

/** Comment author - public name only, never the email. */
export interface CommentAuthorDTO {
  id: string;
  handle: string | null;
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
  /** Mentioned user ids - targets validated server-side at creation. */
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** People the viewer may mention on a given trade (owner + scoped mentors). */
export interface MentionableUserDTO {
  id: string;
  handle: string | null;
  displayName: string;
  isOwner: boolean;
}

export interface CommentsPayloadDTO {
  comments: TradeCommentDTO[];
  mentionable: MentionableUserDTO[];
  canComment: boolean;
  lastReadAt: string | null;
}

/** Resource types for MentorAccessLog. */
export const MENTOR_RESOURCE_TYPES = [
  "TRADES",
  "TRADE_DETAIL",
  "JOURNAL",
  "ANALYTICS",
] as const;

export type MentorResourceType = (typeof MENTOR_RESOURCE_TYPES)[number];
