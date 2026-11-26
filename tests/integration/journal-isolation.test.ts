/**
 * Lot 4 — Journal isolation for the two tables the Supabase advisor
 * alert exposed (journal_period_reviews, journal_templates).
 *
 * These two tables were missing from prisma/rls.sql, so the public
 * PostgREST API could reach them until the script is re-run. The app
 * layer must still never leak them across users: every read, write,
 * update, delete and export is scoped by userId, and the API routes
 * only ever pass the signed-in user's id.
 *
 * Proves, against a dedicated PostgreSQL test schema (promethe_test),
 * that user B can neither read nor modify user A's period reviews and
 * journal templates — through the server functions and through the
 * API route handlers (with a real session cookie), and that B's own
 * upsert creates B's row instead of touching A's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
const cookieStore = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name)
        ? { name, value: cookieStore.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { createSession } from "@/server/session";
import {
  deleteJournalTemplate,
  getJournalExportData,
  getJournalPeriodReview,
  listJournalTemplates,
  updateJournalTemplate,
  upsertJournalEntry,
  upsertJournalPeriodReview,
} from "@/server/journal";
import { GET as listTemplates } from "@/app/api/journal/templates/route";
import {
  DELETE as deleteTemplate,
  PATCH as patchTemplate,
} from "@/app/api/journal/templates/[id]/route";
import {
  GET as getPeriodReview,
  PUT as putPeriodReview,
} from "@/app/api/journal/period-reviews/route";

let userA: { id: string };
let userB: { id: string };
let templateAId: string;

const WEEK = {
  periodType: "WEEKLY" as const,
  periodStart: "2026-11-16",
  periodEnd: "2026-11-22",
};

async function loginAs(userId: string) {
  cookieStore.clear();
  await createSession(userId);
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "journal-a@test.local",
    password: "test-password-123",
    displayName: "Journal A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "journal-b@test.local",
    password: "test-password-123",
    displayName: "Journal B",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  await upsertJournalEntry(userA.id, {
    date: "2026-11-17",
    preMarketPlan: "A plan",
    keyLesson: "A lesson",
  });
  await upsertJournalPeriodReview(userA.id, {
    ...WEEK,
    whatWentWell: "A went well",
    keyLesson: "A lesson",
  });
  const template = await db.journalTemplate.create({
    data: {
      userId: userA.id,
      name: "A template",
      description: "A description",
    },
  });
  templateAId = template.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("journal isolation — period reviews and templates", () => {
  it("server: B cannot read A's period review or templates", async () => {
    expect(
      await getJournalPeriodReview(userB.id, WEEK.periodType, WEEK.periodStart),
    ).toBeNull();
    expect(await listJournalTemplates(userB.id)).toEqual([]);
    expect(await listJournalTemplates(userA.id)).toHaveLength(1);
  });

  it("server: B cannot update or delete A's template", async () => {
    expect(
      await updateJournalTemplate(userB.id, templateAId, { name: "Hijacked" }),
    ).toBeNull();
    expect(await deleteJournalTemplate(userB.id, templateAId)).toBe(false);
    const stillThere = await db.journalTemplate.findUnique({
      where: { id: templateAId },
    });
    expect(stillThere?.name).toBe("A template");
    expect(stillThere?.userId).toBe(userA.id);
  });

  it("server: B's upsert creates B's own review, A's stays untouched", async () => {
    await upsertJournalPeriodReview(userB.id, {
      ...WEEK,
      whatWentWell: "B went well",
    });
    const reviewA = await getJournalPeriodReview(
      userA.id,
      WEEK.periodType,
      WEEK.periodStart,
    );
    expect(reviewA?.whatWentWell).toBe("A went well");
    const reviewB = await getJournalPeriodReview(
      userB.id,
      WEEK.periodType,
      WEEK.periodStart,
    );
    expect(reviewB?.whatWentWell).toBe("B went well");
    expect(reviewB?.userId).toBe(userB.id);
  });

  it("server: export contains only the requesting user's data", async () => {
    const exportA = await getJournalExportData(userA.id, "2026-11-16", "2026-11-22");
    expect(exportA.entries).toHaveLength(1);
    expect(exportA.entries[0].preMarketPlan).toBe("A plan");
    expect(exportA.periodReviews).toHaveLength(1);
    expect(exportA.periodReviews[0].whatWentWell).toBe("A went well");

    const exportB = await getJournalExportData(userB.id, "2026-11-16", "2026-11-22");
    expect(exportB.entries).toEqual([]);
    expect(exportB.periodReviews).toHaveLength(1);
    expect(exportB.periodReviews[0].whatWentWell).toBe("B went well");
  });

  it("api: B's template list is empty, A's shows only A's", async () => {
    await loginAs(userB.id);
    const resB = await json(await listTemplates());
    expect(resB.templates).toEqual([]);

    await loginAs(userA.id);
    const resA = await json(await listTemplates());
    expect((resA.templates as unknown[]).length).toBe(1);
    expect(
      (resA.templates as { userId: string }[])[0].userId,
    ).toBe(userA.id);
  });

  it("api: B cannot patch or delete A's template (404), A can", async () => {
    await loginAs(userB.id);
    const patch = await patchTemplate(
      new Request("http://localhost/api/journal/templates/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hijacked" }),
      }),
      { params: Promise.resolve({ id: templateAId }) },
    );
    expect(patch.status).toBe(404);

    const del = await deleteTemplate(
      new Request("http://localhost/api/journal/templates/x", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: templateAId }) },
    );
    expect(del.status).toBe(404);

    const stillThere = await db.journalTemplate.findUnique({
      where: { id: templateAId },
    });
    expect(stillThere?.name).toBe("A template");
  });

  it("api: B's period-review read returns B's review, never A's", async () => {
    await loginAs(userB.id);
    const getB = await json(
      await getPeriodReview(
        new Request(
          "http://localhost/api/journal/period-reviews?periodType=WEEKLY&periodStart=2026-11-16",
        ),
      ),
    );
    // B already has a review for this week (server test above); the read
    // must return B's row, never A's.
    expect((getB.review as { userId: string }).userId).toBe(userB.id);
    expect((getB.review as { whatWentWell: string }).whatWentWell).toBe(
      "B went well",
    );

    const getFresh = await json(
      await getPeriodReview(
        new Request(
          "http://localhost/api/journal/period-reviews?periodType=WEEKLY&periodStart=2026-11-09",
        ),
      ),
    );
    expect(getFresh.review).toBeNull();

    const put = await putPeriodReview(
      new Request("http://localhost/api/journal/period-reviews", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodType: "WEEKLY",
          periodStart: "2026-11-09",
          periodEnd: "2026-11-15",
          whatWentWell: "B fresh week",
        }),
      }),
    );
    expect(put.status).toBe(200);
    const body = await json(put);
    expect((body.review as { userId: string }).userId).toBe(userB.id);

    // A's review for the original week is untouched by B's writes.
    const reviewA = await getJournalPeriodReview(
      userA.id,
      WEEK.periodType,
      WEEK.periodStart,
    );
    expect(reviewA?.whatWentWell).toBe("A went well");
  });
});
