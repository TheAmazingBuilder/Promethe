/**
 * v3 Phase 5 — Mentor service (server-only).
 *
 * Owner side: invitations (single-use token, shown once, HMAC-stored),
 * access management (scope edit / pause / revoke with IMMEDIATE effect —
 * every read re-checks the row, nothing is cached), aggregated access logs.
 * Mentor side: received invitations, mentee summaries, requireMentorContext()
 * which builds the constrained read-only AccessContext (v3 §1).
 *
 * Security invariants:
 *  - The ownerId ALWAYS comes from the session or the DB row, never the client.
 *  - Mentors are read-only: no function here mutates the owner's journal.
 *  - Expiry is computed at read time (no cron needed to lose access).
 */
import type { Prisma, MentorAccess } from "@prisma/client";
import { db } from "@/lib/db";
import { generateToken, hashToken, tokenPrefixOf } from "@/lib/tokens";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  AccessDeniedError,
  accountFilter,
  mentorContext,
  type AccessContext,
  type AccessScope,
} from "@/lib/access";
import { notifyInApp } from "@/server/notifications";
import type {
  MentorPermissions,
  MentorInviteInput,
  MentorAccessPatch,
} from "@/lib/validations/mentor";
import type {
  MentorAccessDTO,
  MentorAccessLogDTO,
  MentorInvitationDTO,
  MenteeSummaryDTO,
  ReceivedInvitationDTO,
} from "@/lib/mentor/dto";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITES = 10;

export class MentorValidationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "MentorValidationError";
    this.code = code;
    this.status = status;
  }
}

// ── permissions (de)serialization ────────────────────────────────────────────

export function permissionsToJson(p: MentorPermissions): string {
  return JSON.stringify({ ...p, expiresAt: p.expiresAt ?? null });
}

export function parsePermissions(json: string): MentorPermissions {
  try {
    const raw = JSON.parse(json) as Partial<MentorPermissions>;
    return {
      accountScope: raw.accountScope === "LIST" ? "LIST" : "ALL",
      accountIds: Array.isArray(raw.accountIds)
        ? raw.accountIds.filter((v): v is string => typeof v === "string")
        : [],
      strategyScope: raw.strategyScope === "LIST" ? "LIST" : "ALL",
      strategyIds: Array.isArray(raw.strategyIds)
        ? raw.strategyIds.filter((v): v is string => typeof v === "string")
        : [],
      canViewAmounts: raw.canViewAmounts !== false,
      canViewJournal: raw.canViewJournal === true,
      canViewScreenshots: raw.canViewScreenshots === true,
      canViewAnalytics: raw.canViewAnalytics !== false,
      canComment: raw.canComment === true,
      expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : null,
    };
  } catch {
    return {
      accountScope: "ALL",
      accountIds: [],
      strategyScope: "ALL",
      strategyIds: [],
      canViewAmounts: true,
      canViewJournal: false,
      canViewScreenshots: false,
      canViewAnalytics: true,
      canComment: false,
      expiresAt: null,
    };
  }
}

/** AccessContext scope built from an access row (JSON lists parsed). */
export function accessScopeOf(access: MentorAccess): AccessScope {
  const permissions = parsePermissions(
    JSON.stringify({
      accountScope: access.accountScope,
      accountIds: safeParseList(access.accountIdsJson),
      strategyScope: access.strategyScope,
      strategyIds: safeParseList(access.strategyIdsJson),
      canViewAmounts: access.canViewAmounts,
      canViewJournal: access.canViewJournal,
      canViewScreenshots: access.canViewScreenshots,
      canViewAnalytics: access.canViewAnalytics,
      canComment: access.canComment,
    })
  );
  return {
    accountIds: permissions.accountScope === "LIST" ? permissions.accountIds : "ALL",
    strategyIds: permissions.strategyScope === "LIST" ? permissions.strategyIds : "ALL",
    canViewAmounts: permissions.canViewAmounts,
    canViewJournal: permissions.canViewJournal,
    canViewScreenshots: permissions.canViewScreenshots,
    canViewAnalytics: permissions.canViewAnalytics,
    canComment: permissions.canComment,
  };
}

function safeParseList(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function isLive(access: MentorAccess): boolean {
  if (access.status !== "ACTIVE") return false;
  if (access.expiresAt && access.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

// ── owner side: invitations ──────────────────────────────────────────────────

export interface InviteResult {
  invitation: MentorInvitationDTO;
  /** Raw accept URL - returned ONCE, never stored or logged. */
  inviteUrl: string;
}

export async function createInvitation(
  ownerId: string,
  input: MentorInviteInput
): Promise<InviteResult> {
  // Rate limit: 10 invitations per owner per day (DB bucket, hashed key shape
  // kept internal — the key contains no personal data).
  const rl = await consumeRateLimit(`mentor-inv:${ownerId}`, 10, 24 * 60 * 60 * 1000);
  if (!rl.allowed) {
    throw new MentorValidationError(
      "INVITE_RATE_LIMITED",
      "Too many invitations sent today. Please try again tomorrow.",
      429
    );
  }

  const owner = await db.user.findUnique({
    where: { id: ownerId },
    include: { profile: true },
  });
  if (!owner?.profile?.handle) {
    throw new MentorValidationError(
      "HANDLE_REQUIRED",
      "Choose your handle first (Settings → Mentors) before inviting."
    );
  }
  if (input.email === owner.email.toLowerCase()) {
    throw new MentorValidationError(
      "SELF_INVITE",
      "You cannot invite yourself."
    );
  }

  // No duplicate pending invitation for the same email, no re-invite of an
  // existing active mentor (edit their scope instead).
  const invitee = await db.user.findUnique({ where: { email: input.email } });
  const [pending, existingAccess] = await Promise.all([
    db.mentorInvitation.findFirst({
      where: { ownerId, inviteeEmail: input.email, status: "PENDING" },
    }),
    invitee
      ? db.mentorAccess.findUnique({
          where: { ownerId_mentorId: { ownerId, mentorId: invitee.id } },
        })
      : null,
  ]);
  if (pending) {
    throw new MentorValidationError(
      "INVITE_ALREADY_PENDING",
      "An invitation is already pending for this email."
    );
  }
  if (existingAccess && isLive(existingAccess)) {
    throw new MentorValidationError(
      "MENTOR_ALREADY_ACTIVE",
      "This mentor already has active access – change their permissions instead."
    );
  }

  const pendingCount = await db.mentorInvitation.count({
    where: { ownerId, status: "PENDING", expiresAt: { gt: new Date() } },
  });
  if (pendingCount >= MAX_PENDING_INVITES) {
    throw new MentorValidationError(
      "TOO_MANY_PENDING",
      `Maximum ${MAX_PENDING_INVITES} pending invitations.`,
    );
  }

  const token = `mtr_${generateToken()}`;
  const invitation = await db.mentorInvitation.create({
    data: {
      ownerId,
      inviteeEmail: input.email,
      tokenHash: hashToken(token),
      permissionsJson: permissionsToJson(input.permissions),
      status: "PENDING",
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const inviteUrl = `${baseUrl.replace(/\/+$/, "")}/invitation/${token}`;

  // In-app notification when the invitee already has an account (email channel
  // is a documented production addition — sandbox has no SMTP).
  if (invitee) {
    const ownerName = owner.profile.publicDisplayName || owner.profile.displayName;
    await notifyInApp({
      userId: invitee.id,
      type: "MENTOR_INVITE_RECEIVED",
      title: "Mentorship invitation",
      body: `${ownerName} (@${owner.profile.handle}) invites you to follow their trading journal.`,
      url: `/invitation/${token}`,
      dedupeWithinMs: 60 * 60 * 1000,
    });
  }

  return {
    invitation: toInvitationDTO(invitation),
    inviteUrl,
  };
}

function toInvitationDTO(row: {
  id: string;
  inviteeEmail: string;
  status: string;
  permissionsJson: string;
  createdAt: Date;
  expiresAt: Date;
}): MentorInvitationDTO {
  const permissions = parsePermissions(row.permissionsJson);
  const expired = row.status === "PENDING" && row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id,
    inviteeEmail: row.inviteeEmail,
    status: expired ? "EXPIRED" : (row.status as MentorInvitationDTO["status"]),
    permissions,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function revokeInvitation(ownerId: string, invitationId: string): Promise<void> {
  const row = await db.mentorInvitation.findFirst({ where: { id: invitationId, ownerId } });
  if (!row) throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  if (row.status === "PENDING") {
    await db.mentorInvitation.update({
      where: { id: row.id },
      data: { status: "REVOKED" },
    });
  }
}

// ── owner side: accesses ─────────────────────────────────────────────────────

const ACCESS_INCLUDE = { mentor: { include: { profile: true } } } as const;
type AccessRow = Prisma.MentorAccessGetPayload<{ include: typeof ACCESS_INCLUDE }>;

function toAccessDTO(row: AccessRow): MentorAccessDTO {
  const permissions = parsePermissions(
    JSON.stringify({
      accountScope: row.accountScope,
      accountIds: safeParseList(row.accountIdsJson),
      strategyScope: row.strategyScope,
      strategyIds: safeParseList(row.strategyIdsJson),
      canViewAmounts: row.canViewAmounts,
      canViewJournal: row.canViewJournal,
      canViewScreenshots: row.canViewScreenshots,
      canViewAnalytics: row.canViewAnalytics,
      canComment: row.canComment,
    })
  );
  return {
    id: row.id,
    mentorId: row.mentorId,
    mentorHandle: row.mentor.profile?.handle ?? null,
    mentorDisplayName:
      row.mentor.profile?.publicDisplayName || row.mentor.profile?.displayName || "Mentor",
    status: row.status as MentorAccessDTO["status"],
    permissions,
    createdAt: row.createdAt.toISOString(),
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  };
}

export interface MentorsOverview {
  accesses: MentorAccessDTO[];
  invitations: MentorInvitationDTO[];
  logs: MentorAccessLogDTO[];
  handle: string | null;
  suggestedHandle: string;
}

export async function listMentors(
  ownerId: string,
  suggestedHandle: string
): Promise<MentorsOverview> {
  const [profile, accesses, invitations, logs] = await Promise.all([
    db.profile.findUnique({ where: { id: ownerId }, select: { handle: true } }),
    db.mentorAccess.findMany({
      where: { ownerId, status: { not: "REVOKED" } },
      include: ACCESS_INCLUDE,
      orderBy: { createdAt: "desc" },
    }),
    db.mentorInvitation.findMany({
      where: { ownerId, status: { in: ["PENDING", "DECLINED", "EXPIRED"] } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.mentorAccessLog.findMany({
      where: { ownerId, day: { gte: isoDay(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      orderBy: { day: "desc" },
      take: 200,
    }),
  ]);

  // Resolve mentor display info for logs (small map over unique ids).
  const mentorIds = [...new Set(logs.map((l) => l.mentorId))];
  const mentors = mentorIds.length
    ? await db.user.findMany({
        where: { id: { in: mentorIds } },
        include: { profile: true },
      })
    : [];
  const nameById = new Map(
    mentors.map((m) => [
      m.id,
      {
        handle: m.profile?.handle ?? null,
        name: m.profile?.publicDisplayName || m.profile?.displayName || "Mentor",
      },
    ])
  );

  return {
    accesses: accesses.map(toAccessDTO),
    invitations: invitations.map(toInvitationDTO),
    logs: logs.map((l) => ({
      mentorHandle: nameById.get(l.mentorId)?.handle ?? null,
      mentorDisplayName: nameById.get(l.mentorId)?.name ?? "Mentor",
      resourceType: l.resourceType,
      day: l.day,
      viewCount: l.viewCount,
    })),
    handle: profile?.handle ?? null,
    suggestedHandle,
  };
}

export async function updateAccess(
  ownerId: string,
  accessId: string,
  patch: MentorAccessPatch
): Promise<MentorAccessDTO> {
  const row = await db.mentorAccess.findFirst({ where: { id: accessId, ownerId } });
  if (!row) throw new MentorValidationError("ACCESS_NOT_FOUND", "Access not found.", 404);
  if (row.status === "REVOKED") {
    throw new MentorValidationError("ACCESS_REVOKED", "This access has been revoked – invite the mentor again.");
  }

  const data: Prisma.MentorAccessUpdateInput = {};
  if (patch.status) data.status = patch.status;
  if (patch.permissions) {
    const p = patch.permissions;
    data.accountScope = p.accountScope;
    data.accountIdsJson = JSON.stringify(p.accountIds);
    data.strategyScope = p.strategyScope;
    data.strategyIdsJson = JSON.stringify(p.strategyIds);
    data.canViewAmounts = p.canViewAmounts;
    data.canViewJournal = p.canViewJournal;
    data.canViewScreenshots = p.canViewScreenshots;
    data.canViewAnalytics = p.canViewAnalytics;
    data.canComment = p.canComment;
    data.expiresAt = p.expiresAt ? new Date(p.expiresAt) : null;
  }

  const updated = await db.mentorAccess.update({
    where: { id: row.id },
    data,
    include: ACCESS_INCLUDE,
  });
  return toAccessDTO(updated);
}

export async function revokeAccess(ownerId: string, accessId: string): Promise<void> {
  const row = await db.mentorAccess.findFirst({
    where: { id: accessId, ownerId },
    include: { owner: { include: { profile: true } }, mentor: { include: { profile: true } } },
  });
  if (!row) throw new MentorValidationError("ACCESS_NOT_FOUND", "Access not found.", 404);
  if (row.status !== "REVOKED") {
    await db.mentorAccess.update({
      where: { id: row.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const ownerName = row.owner.profile?.publicDisplayName || row.owner.profile?.displayName;
    await notifyInApp({
      userId: row.mentorId,
      type: "MENTOR_ACCESS_REVOKED",
      title: "Access revoked",
      body: `${ownerName ?? "A trader"} revoked your mentorship access.`,
      url: null,
      dedupeWithinMs: 0,
    });
  }
}

// ── mentor side: invitations ─────────────────────────────────────────────────

export async function listReceivedInvitations(viewer: {
  id: string;
  email: string;
}): Promise<ReceivedInvitationDTO[]> {
  const rows = await db.mentorInvitation.findMany({
    where: { inviteeEmail: viewer.email.toLowerCase() },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const owners = ownerIds.length
    ? await db.user.findMany({ where: { id: { in: ownerIds } }, include: { profile: true } })
    : [];
  const ownerById = new Map(
    owners.map((o) => [
      o.id,
      {
        handle: o.profile?.handle ?? null,
        name: o.profile?.publicDisplayName || o.profile?.displayName || "Trader",
      },
    ])
  );

  return rows.map((row) => {
    const permissions = parsePermissions(row.permissionsJson);
    const owner = ownerById.get(row.ownerId);
    const expired = row.status === "PENDING" && row.expiresAt.getTime() <= Date.now();
    return {
      id: row.id,
      ownerHandle: owner?.handle ?? null,
      ownerDisplayName: owner?.name ?? "Trader",
      permissions,
      status: expired ? "EXPIRED" : (row.status as ReceivedInvitationDTO["status"]),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  });
}

export async function acceptInvitation(
  token: string,
  viewer: { id: string; email: string }
): Promise<{ ownerId: string; ownerDisplayName: string }> {
  const tokenHash = hashToken(token);
  const invitation = await db.mentorInvitation.findUnique({ where: { tokenHash } });
  if (!invitation) {
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  if (invitation.status !== "PENDING") {
    throw new MentorValidationError(
      "INVITE_NOT_PENDING",
      "This invitation has already been handled."
    );
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    await db.mentorInvitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    throw new MentorValidationError("INVITE_EXPIRED", "This invitation has expired.");
  }
  if (invitation.inviteeEmail !== viewer.email.toLowerCase()) {
    // Neutral message — do not leak the invitation's existence to a wrong account.
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  if (invitation.ownerId === viewer.id) {
    throw new MentorValidationError("SELF_INVITE", "Invalid invitation.");
  }

  const viewerProfile = await db.profile.findUnique({ where: { id: viewer.id } });
  if (!viewerProfile?.handle) {
    throw new MentorValidationError(
      "HANDLE_REQUIRED",
      "Choose your handle first (Settings → Mentors) to accept a mentorship."
    );
  }

  const permissions = parsePermissions(invitation.permissionsJson);
  const result = await db.$transaction(async (tx) => {
    // Upsert: a previously revoked/paused pair is reactivated with the new scope.
    const data = {
      status: "ACTIVE",
      accountScope: permissions.accountScope,
      accountIdsJson: JSON.stringify(permissions.accountIds),
      strategyScope: permissions.strategyScope,
      strategyIdsJson: JSON.stringify(permissions.strategyIds),
      canViewAmounts: permissions.canViewAmounts,
      canViewJournal: permissions.canViewJournal,
      canViewScreenshots: permissions.canViewScreenshots,
      canViewAnalytics: permissions.canViewAnalytics,
      canComment: permissions.canComment,
      expiresAt: permissions.expiresAt ? new Date(permissions.expiresAt) : null,
      revokedAt: null,
    };
    const access = await tx.mentorAccess.upsert({
      where: { ownerId_mentorId: { ownerId: invitation.ownerId, mentorId: viewer.id } },
      create: { ownerId: invitation.ownerId, mentorId: viewer.id, ...data },
      update: data,
    });
    await tx.mentorInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
    return access;
  });

  const [owner, mentorProfile] = await Promise.all([
    db.user.findUnique({ where: { id: invitation.ownerId }, include: { profile: true } }),
    db.profile.findUnique({ where: { id: viewer.id } }),
  ]);
  const ownerName =
    owner?.profile?.publicDisplayName || owner?.profile?.displayName || "A trader";
  await notifyInApp({
    userId: invitation.ownerId,
    type: "MENTOR_INVITE_ACCEPTED",
    title: "Mentorship accepted",
    body: `${mentorProfile?.publicDisplayName || mentorProfile?.displayName || "Your mentor"} (@${viewerProfile.handle}) accepted your invitation.`,
    url: "/settings/mentors",
    dedupeWithinMs: 0,
  });

  return { ownerId: result.ownerId, ownerDisplayName: ownerName };
}

export async function declineInvitation(
  token: string,
  viewer: { id: string; email: string }
): Promise<void> {
  const tokenHash = hashToken(token);
  const invitation = await db.mentorInvitation.findUnique({ where: { tokenHash } });
  if (!invitation || invitation.status !== "PENDING") {
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  if (invitation.inviteeEmail !== viewer.email.toLowerCase()) {
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  await db.mentorInvitation.update({
    where: { id: invitation.id },
    data: { status: "DECLINED" },
  });
}

// ── id-based variants (in-app invitation center) ──────────────────────────
//
// The in-app list cannot expose raw tokens (only hashes are stored). These
// variants key on the invitation id but keep the SAME security gate: the
// logged-in account's email must EQUAL the invited email. A logged-in user
// can therefore never act on an invitation addressed to someone else.

/**
 * Token-link preview (before accept/decline): owner display info and granted
 * permissions. Email match enforced — a prober with a leaked link gets 404.
 */
export async function previewInvitation(
  token: string,
  viewer: { id: string; email: string }
): Promise<ReceivedInvitationDTO> {
  const tokenHash = hashToken(token);
  const invitation = await db.mentorInvitation.findUnique({ where: { tokenHash } });
  if (
    !invitation ||
    invitation.status !== "PENDING" ||
    invitation.expiresAt.getTime() <= Date.now() ||
    invitation.inviteeEmail !== viewer.email.toLowerCase()
  ) {
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  const owner = await db.user.findUnique({
    where: { id: invitation.ownerId },
    include: { profile: true },
  });
  return {
    id: invitation.id,
    ownerHandle: owner?.profile?.handle ?? null,
    ownerDisplayName:
      owner?.profile?.publicDisplayName || owner?.profile?.displayName || "Trader",
    permissions: parsePermissions(invitation.permissionsJson),
    status: "PENDING",
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function acceptInvitationById(
  invitationId: string,
  viewer: { id: string; email: string }
): Promise<{ ownerId: string; ownerDisplayName: string }> {
  const invitation = await db.mentorInvitation.findUnique({ where: { id: invitationId } });
  if (
    !invitation ||
    invitation.status !== "PENDING" ||
    invitation.inviteeEmail !== viewer.email.toLowerCase()
  ) {
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  const token = `mtr_${generateToken()}`;
  // Reuse the token flow by minting a fresh single-use token bound to the
  // SAME invitation row (the old hashed token is replaced).
  await db.mentorInvitation.update({
    where: { id: invitation.id },
    data: { tokenHash: hashToken(token) },
  });
  return acceptInvitation(token, viewer);
}

export async function declineInvitationById(
  invitationId: string,
  viewer: { id: string; email: string }
): Promise<void> {
  const invitation = await db.mentorInvitation.findUnique({ where: { id: invitationId } });
  if (
    !invitation ||
    invitation.status !== "PENDING" ||
    invitation.inviteeEmail !== viewer.email.toLowerCase()
  ) {
    throw new MentorValidationError("INVITE_NOT_FOUND", "Invitation not found.", 404);
  }
  await db.mentorInvitation.update({
    where: { id: invitation.id },
    data: { status: "DECLINED" },
  });
}

// ── mentor side: context & mentees ───────────────────────────────────────────

/**
 * Builds the constrained read-only mentor context. Throws AccessDeniedError
 * unless the access row is ACTIVE and unexpired — pause/expiry/revoke take
 * effect on the NEXT request (nothing is cached).
 */
export async function requireMentorContext(
  viewerId: string,
  ownerId: string
): Promise<AccessContext> {
  if (viewerId === ownerId) {
    throw new AccessDeniedError("Self-mentorship is not possible.");
  }
  const access = await db.mentorAccess.findUnique({
    where: { ownerId_mentorId: { ownerId, mentorId: viewerId } },
  });
  if (!access || !isLive(access)) {
    throw new AccessDeniedError("Mentorship access missing, expired or revoked.");
  }
  return mentorContext(viewerId, ownerId, accessScopeOf(access));
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Records a mentor view: throttled lastViewedAt write (≥ 1 min apart) and a
 * per-day aggregated MentorAccessLog row (privacy transparency, kept small).
 */
export async function touchMentorView(
  ctx: AccessContext,
  resourceType: string,
  resourceId?: string | null
): Promise<void> {
  if (ctx.role !== "MENTOR") return;
  const day = isoDay(Date.now());
  try {
    await db.mentorAccess.updateMany({
      where: {
        ownerId: ctx.ownerId,
        mentorId: ctx.viewerId,
        OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: new Date(Date.now() - 60_000) } }],
      },
      data: { lastViewedAt: new Date() },
    });
    await db.mentorAccessLog.upsert({
      where: {
        ownerId_mentorId_resourceType_resourceId_day: {
          ownerId: ctx.ownerId,
          mentorId: ctx.viewerId,
          resourceType,
          resourceId: resourceId ?? "",
          day,
        },
      },
      create: {
        ownerId: ctx.ownerId,
        mentorId: ctx.viewerId,
        resourceType,
        resourceId: resourceId ?? null,
        day,
        viewCount: 1,
      },
      update: { viewCount: { increment: 1 } },
    });
  } catch (error) {
    console.error("[mentors] touchMentorView failed:", error);
  }
}

/** Prisma trade filter for a mentor context (account + strategy scope). */
export function mentorTradeWhere(ctx: AccessContext): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = {
    userId: ctx.ownerId,
    isDraft: false,
    ...accountFilter(ctx),
  };
  if (ctx.scope.strategyIds !== "ALL") {
    where.OR = [
      { strategyId: { in: ctx.scope.strategyIds } },
      { strategyId: null },
    ];
  }
  return where;
}

export async function listMentees(mentorId: string): Promise<MenteeSummaryDTO[]> {
  const accesses = await db.mentorAccess.findMany({
    where: { mentorId, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { owner: { include: { profile: true } } },
    orderBy: { lastViewedAt: "desc" },
  });

  const summaries: MenteeSummaryDTO[] = [];
  for (const access of accesses) {
    const ctx = mentorContext(mentorId, access.ownerId, accessScopeOf(access));
    const where = mentorTradeWhere(ctx);
    const since = access.lastViewedAt ?? new Date(0);

    const [newTrades, unreviewed, recentTradeIds] = await Promise.all([
      db.trade.count({ where: { ...where, createdAt: { gt: since } } }),
      db.trade.count({ where: { ...where, reviewStatus: "NOT_REVIEWED" } }),
      db.trade.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    // Unread comments: comments by others on scoped trades newer than my
    // last-read marker for that trade. Bounded to the recent 200 trades and
    // the 1000 most recent comments (badge approximation, documented).
    const ids = recentTradeIds.map((t) => t.id);
    let unreadComments = 0;
    if (ids.length) {
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
      for (const comment of comments) {
        const lastRead = lastReadByTrade.get(comment.tradeId) ?? 0;
        if (comment.createdAt.getTime() > lastRead) unreadComments += 1;
      }
    }

    const owner = access.owner;
    summaries.push({
      ownerId: access.ownerId,
      ownerHandle: owner.profile?.handle ?? null,
      ownerDisplayName:
        owner.profile?.publicDisplayName || owner.profile?.displayName || "Trader",
      permissions: permissionsOfAccess(access),
      lastViewedAt: access.lastViewedAt?.toISOString() ?? null,
      newTradesSince: newTrades,
      unreviewedCount: unreviewed,
      unreadComments,
    });
  }
  return summaries;
}

function permissionsOfAccess(access: MentorAccess): MentorPermissions {
  return parsePermissions(
    JSON.stringify({
      accountScope: access.accountScope,
      accountIds: safeParseList(access.accountIdsJson),
      strategyScope: access.strategyScope,
      strategyIds: safeParseList(access.strategyIdsJson),
      canViewAmounts: access.canViewAmounts,
      canViewJournal: access.canViewJournal,
      canViewScreenshots: access.canViewScreenshots,
      canViewAnalytics: access.canViewAnalytics,
      canComment: access.canComment,
      expiresAt: access.expiresAt?.toISOString() ?? null,
    })
  );
}
