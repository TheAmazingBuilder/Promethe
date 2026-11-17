/**
 * User lifecycle — server-side data access (never imported by client code).
 * Every function scopes queries by userId; no Prisma error ever reaches the client.
 */
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/server/consent";
import type {
  SessionPayload,
  SessionProfile,
  ProfilePreferences,
} from "@/lib/auth/types";

type ProfileRow = {
  displayName: string;
  timezone: string;
  baseCurrency: string;
  locale: string;
  theme: string;
  defaultAccountId: string | null;
  preferencesJson?: string | null;
  handle?: string | null;
  publicDisplayName?: string | null;
};

/** Safe parse of Profile.preferencesJson - never throws, defaults to {}. */
export function parsePreferences(json: string | null | undefined): ProfilePreferences {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: ProfilePreferences = {};
    if (typeof parsed.lastAccountId === "string") out.lastAccountId = parsed.lastAccountId;
    if (typeof parsed.lastInstrumentId === "string") out.lastInstrumentId = parsed.lastInstrumentId;
    if (typeof parsed.lastTimeframe === "string") out.lastTimeframe = parsed.lastTimeframe;
    if (parsed.rememberedLots && typeof parsed.rememberedLots === "object") {
      const lots: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.rememberedLots as Record<string, unknown>)) {
        if (typeof v === "string") lots[k] = v;
      }
      out.rememberedLots = lots;
    }
    if (Array.isArray(parsed.favoriteInstrumentIds)) {
      out.favoriteInstrumentIds = parsed.favoriteInstrumentIds.filter(
        (v): v is string => typeof v === "string"
      );
    }
    return out;
  } catch {
    return {};
  }
}

const FALLBACK_PROFILE: SessionProfile = {
  displayName: "Trader",
  timezone: "UTC",
  baseCurrency: "USD",
  locale: "en",
  theme: "system",
  defaultAccountId: null,
  preferences: {},
  handle: null,
  publicDisplayName: null,
};

/** Maps DB rows to the client-safe session payload (profile optional). */
export function toSessionPayload(
  user: { id: string; email: string },
  profile: ProfileRow | null
): SessionPayload {
  return {
    user: { id: user.id, email: user.email },
    profile: profile
      ? {
          displayName: profile.displayName,
          timezone: profile.timezone,
          baseCurrency: profile.baseCurrency,
          locale: profile.locale,
          theme: profile.theme,
          defaultAccountId: profile.defaultAccountId,
          preferences: parsePreferences(profile.preferencesJson),
          handle: profile.handle ?? null,
          publicDisplayName: profile.publicDisplayName ?? null,
        }
      : { ...FALLBACK_PROFILE },
  };
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  timezone: string;
  baseCurrency: string;
  locale: string;
}

/**
 * Signup transaction: User → default Account → Profile linked to it, plus
 * TERMS/PRIVACY consent records (RGPD art. 7 — atomic: no user without proof
 * of consent can ever exist).
 * The default DEMO account (10 000 USD) gives trades somewhere to live from
 * the first minute; users rename or replace it in Réglages (phase 7).
 */
export async function createUserWithDefaults(
  input: CreateUserInput
): Promise<SessionPayload> {
  const passwordHash = hashPassword(input.password);

  const created = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, passwordHash },
    });
    // v3 Phase 6 — consent proof, same transaction as the user itself.
    await tx.consentRecord.createMany({
      data: [
        { userId: user.id, type: "TERMS", version: TERMS_VERSION, granted: true },
        { userId: user.id, type: "PRIVACY", version: PRIVACY_VERSION, granted: true },
      ],
    });
    const account = await tx.account.create({
      data: {
        userId: user.id,
        name: "Main account",
        type: "DEMO",
        currency: input.baseCurrency,
        initialBalance: "10000",
      },
    });
    const profile = await tx.profile.create({
      data: {
        id: user.id,
        displayName: input.displayName,
        timezone: input.timezone,
        baseCurrency: input.baseCurrency,
        locale: input.locale,
        defaultAccountId: account.id,
      },
    });
    return { user, profile };
  });

  return toSessionPayload(created.user, created.profile);
}

/**
 * Idempotent setup repair for legacy rows (profile missing): recreates the
 * default profile + account. Called on login.
 */
export async function ensureUserSetup(userId: string): Promise<SessionPayload> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) throw new Error("User not found");
  if (user.profile) return toSessionPayload(user, user.profile);

  const profile = await db.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        userId,
        name: "Main account",
        type: "DEMO",
        currency: "USD",
        initialBalance: "10000",
      },
    });
    return tx.profile.create({
      data: {
        id: userId,
        displayName: user.email.split("@")[0].slice(0, 60) || "Trader",
        timezone: "UTC",
        baseCurrency: "USD",
        locale: "en",
        defaultAccountId: account.id,
      },
    });
  });

  return toSessionPayload(user, profile);
}

/**
 * Partial profile update — every field is optional; the row is keyed by the
 * session user id (ownership guaranteed), never by a client-provided id.
 * `preferences` is MERGED into the stored JSON (partial patch semantics).
 */
export async function updateProfile(
  userId: string,
  patch: {
    displayName?: string;
    timezone?: string;
    baseCurrency?: string;
    locale?: string;
    theme?: string;
    preferences?: ProfilePreferences;
  }
): Promise<SessionPayload> {
  // Repair legacy rows first so the update always has a target.
  await ensureUserSetup(userId);
  if (patch.preferences) {
    const current = await db.profile.findUniqueOrThrow({
      where: { id: userId },
      select: { preferencesJson: true },
    });
    const merged = { ...parsePreferences(current.preferencesJson), ...patch.preferences };
    // Cap the remembered-lots map (defensive: bounded JSON).
    if (merged.rememberedLots) {
      const entries = Object.entries(merged.rememberedLots).slice(0, 50);
      merged.rememberedLots = Object.fromEntries(entries);
    }
    await db.profile.update({
      where: { id: userId },
      data: { preferencesJson: JSON.stringify(merged) },
    });
  }
  const { preferences: _prefs, ...rest } = patch;
  if (Object.keys(rest).length > 0) {
    await db.profile.update({ where: { id: userId }, data: rest });
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
  return toSessionPayload(user, user.profile);
}

// ── v3 Phase 5 — mentoring handle ────────────────────────────────────────────

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;

/** Typed validation error mapped by apiError() into a consistent envelope. */
export class UserValidationError extends Error {
  code: string;
  status = 422;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UserValidationError";
    this.code = code;
  }
}

function handleCandidates(seed: string): string[] {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 18);
  const safe = base.length >= 3 ? base : `trader_${base}`;
  return [safe, `${safe}_tj`];
}

/**
 * Auto-suggests an available handle from the user's email/display name.
 * Pure suggestion — nothing is persisted until setHandle succeeds.
 */
export async function suggestHandle(userId: string): Promise<string> {
  const profile = await db.profile.findUnique({ where: { id: userId } });
  const seed = profile?.displayName || "trader";
  const emailSeed = (await db.user.findUnique({ where: { id: userId } }))
    ?.email.split("@")[0];

  const candidates = [
    ...handleCandidates(emailSeed ?? ""),
    ...handleCandidates(seed),
  ];
  for (const candidate of candidates) {
    if (!HANDLE_RE.test(candidate)) continue;
    const taken = await db.profile.findUnique({ where: { handle: candidate } });
    if (!taken) return candidate;
  }
  // Fall back to a random suffix — always valid, near-zero collision odds.
  return `tj_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reserves a handle for the session user (uniqueness enforced atomically by
 * the DB). Throws UserValidationError(HANDLE_TAKEN | HANDLE_INVALID).
 */
export async function setHandle(
  userId: string,
  handle: string,
  publicDisplayName?: string | null
): Promise<SessionPayload> {
  if (!HANDLE_RE.test(handle)) {
    throw new UserValidationError("HANDLE_INVALID", "Invalid handle (a-z, 0-9, _, 3–24).");
  }
  await ensureUserSetup(userId);
  const taken = await db.profile.findUnique({ where: { handle } });
  if (taken && taken.id !== userId) {
    throw new UserValidationError("HANDLE_TAKEN", "This handle is already taken.");
  }
  try {
    await db.profile.update({
      where: { id: userId },
      data: {
        handle,
        ...(publicDisplayName !== undefined
          ? { publicDisplayName: publicDisplayName || null }
          : {}),
      },
    });
  } catch (error) {
    // Unique race — two users claiming the same handle concurrently.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new UserValidationError("HANDLE_TAKEN", "This handle is already taken.");
    }
    throw error;
  }
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
  return toSessionPayload(user, user.profile);
}
