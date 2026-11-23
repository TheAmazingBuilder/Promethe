import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteUpload, readUpload, updateUpload } from "@/server/uploads";

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
        { error: "NOT_FOUND", message: "Screenshot not found." },
        { status: 404 }
      );
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "uploads/[id]");
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { label?: unknown; caption?: unknown } | null;
    if (!body || !(body.label === null || typeof body.label === "string") || !(body.caption === null || typeof body.caption === "string")) {
      return NextResponse.json({ error: "VALIDATION", message: "Invalid screenshot details." }, { status: 422 });
    }
    const upload = await updateUpload(session.user.id, id, { label: body.label, caption: body.caption });
    if (!upload) return NextResponse.json({ error: "NOT_FOUND", message: "Screenshot not found." }, { status: 404 });
    return NextResponse.json({ upload });
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
        { error: "NOT_FOUND", message: "Screenshot not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "uploads/[id]");
  }
}
