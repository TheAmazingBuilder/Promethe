/**
 * GET /api/account/consents — consent history (RGPD art. 7 proof).
 * 200 { consents } · 401
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listConsents } from "@/server/consent";

export async function GET() {
  try {
    const session = await requireUser();
    const consents = await listConsents(session.user.id);
    return NextResponse.json({ consents });
  } catch (error) {
    return apiError(error, "account/consents");
  }
}
