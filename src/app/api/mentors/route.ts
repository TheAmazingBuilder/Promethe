/**
 * GET  /api/mentors — owner overview: accesses, invitations, access logs,
 *                     current handle + a fresh suggestion.
 * POST /api/mentors — invite a mentor by email. The raw accept URL is
 *                     returned ONCE (never stored, never logged).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createInvitation, listMentors } from "@/server/mentors";
import { suggestHandle } from "@/server/users";
import { mentorInviteSchema } from "@/lib/validations/mentor";
import { zodFieldErrors } from "@/lib/validations/shared";

export async function GET() {
  try {
    const session = await requireUser();
    const suggested = await suggestHandle(session.user.id);
    const overview = await listMentors(session.user.id, suggested);
    return NextResponse.json(overview);
  } catch (error) {
    return apiError(error, "mentors");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = mentorInviteSchema.safeParse(body);
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
    const result = await createInvitation(session.user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error, "mentors");
  }
}
