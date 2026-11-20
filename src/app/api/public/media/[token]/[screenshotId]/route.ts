/**
 * GET /api/public/media/[token]/[screenshotId] — public screenshot proxy.
 *
 * No auth: access is granted ONLY through a valid share token whose policy
 * allows screenshots and whose target trade owns the screenshot. Every
 * request re-validates the link, so revoking it kills <img> loads too
 * (shared screenshots die with the link — v3 §4.6).
 *
 * Rate limited per IP (hashed — no raw IPs stored) and per token hash.
 */
import { NextResponse } from "next/server";
import { clientIpFrom, hashIp, hashToken } from "@/lib/tokens";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readPublicScreenshot } from "@/server/sharing";

type Ctx = { params: Promise<{ token: string; screenshotId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { token, screenshotId } = await ctx.params;

    // Rate limits: 120 images / hour / IP, 300 / hour / link.
    const ipLimit = await consumeRateLimit(
      `share:media:ip:${hashIp(clientIpFrom(req.headers))}`,
      120,
      60 * 60 * 1000
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    const tokenLimit = await consumeRateLimit(
      `share:media:token:${hashToken(token)}`,
      300,
      60 * 60 * 1000
    );
    if (!tokenLimit.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const file = await readPublicScreenshot(token, screenshotId);
    if (!file) {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        // Private-ish caching: fine to reuse in the visitor's tab for the
        // link's lifetime, never shared caches.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[api/public/media] failed:", error);
    return new NextResponse(null, { status: 404 });
  }
}
