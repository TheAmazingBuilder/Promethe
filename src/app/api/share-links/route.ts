/**
 * GET  /api/share-links — list the owner's links (no raw tokens, prefix only).
 * POST /api/share-links — create; the raw URL is returned ONCE.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createShareLink, listShareLinks } from "@/server/sharing";
import { shareLinkInputSchema, zodFieldErrors } from "@/lib/validations/shared";

export async function GET() {
  try {
    const session = await requireUser();
    const links = await listShareLinks(session.user.id);
    return NextResponse.json({ links });
  } catch (error) {
    return apiError(error, "share-links");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = shareLinkInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Certains champs sont invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const created = await createShareLink(session.user.id, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "share-links");
  }
}
