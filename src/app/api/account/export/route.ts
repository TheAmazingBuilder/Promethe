/**
 * POST /api/account/export - full ZIP export of the user's data (RGPD art. 20).
 * POST, not GET: building the archive writes a DataExportLog row and
 * consumes the 24 h cooldown, so a cross-site top-level navigation must
 * never be able to trigger it (SameSite=Lax already blocks cross-site
 * POST cookies; a GET would still carry the cookie on navigation).
 * 200 application/zip · 401 · 404 · 429 EXPORT_COOLDOWN (1 per 24 h)
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requestUserExport } from "@/server/account-export";

export async function POST() {
  try {
    const session = await requireUser();
    const result = await requestUserExport(session.user.id);
    if (!result.ok) {
      if (result.code === "RATE_LIMITED") {
        return NextResponse.json(
          {
            error: "EXPORT_COOLDOWN",
            message: "A full export is already available every 24 hours.",
            retryAfterMs: result.retryAfterMs ?? 0,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((result.retryAfterMs ?? 0) / 1000)),
            },
          }
        );
      }
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Account not found." },
        { status: 404 }
      );
    }

    // Copy into a strictly-typed Uint8Array<ArrayBuffer>: fflate's return
    // type (Uint8Array<ArrayBufferLike>) is rejected by BodyInit under TS 5.7+.
    const bytes = new Uint8Array(result.bytes.byteLength);
    bytes.set(result.bytes);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Length": String(result.sizeBytes),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error, "account/export");
  }
}
