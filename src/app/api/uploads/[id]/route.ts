import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteUpload, readUpload } from "@/server/uploads";

/**
 * GET    /api/uploads/[id] — streams the screenshot to its OWNER only.
 * DELETE /api/uploads/[id]
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const file = await readUpload(session.user.id, id);
    if (!file) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Capture introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return apiError(error, "uploads/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteUpload(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Capture introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "uploads/[id]");
  }
}
