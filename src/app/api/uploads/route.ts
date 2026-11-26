import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { saveUpload } from "@/server/uploads";

/**
 * POST /api/uploads — multipart (file, tradeId, label?, caption?).
 * The client compresses to WebP ≤ 1600px q0.8 before sending; the server
 * enforces type + 5 MB as defense in depth. Files land in the private
 * Supabase Storage bucket and are served ONLY via /api/uploads/[id].
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Multipart attendu." },
        { status: 422 }
      );
    }
    const file = form.get("file");
    const tradeId = form.get("tradeId");
    const label = form.get("label");
    const caption = form.get("caption");
    if (!(file instanceof File) || typeof tradeId !== "string" || !tradeId) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Champs manquants (file, tradeId)." },
        { status: 422 }
      );
    }
    const upload = await saveUpload(
      session.user.id,
      tradeId,
      file,
      typeof label === "string" && label ? label : null,
      typeof caption === "string" && caption ? caption : null
    );
    return NextResponse.json({ upload }, { status: 201 });
  } catch (error) {
    return apiError(error, "uploads");
  }
}
