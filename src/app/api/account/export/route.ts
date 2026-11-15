/**
 * GET /api/account/export — full ZIP export of the user's data (RGPD art. 20).
 * 200 application/zip · 401 · 404 · 429 EXPORT_COOLDOWN (1 per 24 h)
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requestUserExport } from "@/server/account-export";

export async function GET() {
  try {
    const session = await requireUser();
    const result = await requestUserExport(session.user.id);
    if (!result.ok) {
      if (result.code === "RATE_LIMITED") {
        return NextResponse.json(
          {
            error: "EXPORT_COOLDOWN",
            message: "Un export complet est déjà disponible toutes les 24 heures.",
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
        { error: "NOT_FOUND", message: "Compte introuvable." },
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
