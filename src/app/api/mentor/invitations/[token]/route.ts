/**
 * POST /api/mentor/invitations/[token] — accept or decline a mentor
 * invitation. The param is EITHER the raw single-use token (from the share
 * link) OR the invitation id (from the in-app list — raw tokens are never
 * exposed twice). Both paths enforce the SAME gate: the logged-in email
 * must equal the invited email, the invitation must be PENDING and unexpired.
 * Wrong account → neutral 404 (no existence signal for a prober).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  acceptInvitation,
  acceptInvitationById,
  declineInvitation,
  declineInvitationById,
  previewInvitation,
} from "@/server/mentors";
import { invitationActionSchema } from "@/lib/validations/mentor";
import { zodFieldErrors } from "@/lib/validations/shared";

type Ctx = { params: Promise<{ token: string }> };

/** GET — preview the invitation (owner + permissions) without acting on it. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { token } = await ctx.params;
    const invitation = await previewInvitation(token, session.user);
    return NextResponse.json({ invitation });
  } catch (error) {
    return apiError(error, "mentor/invitations/[token]");
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { token } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = invitationActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Action invalide.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const isRawToken = token.startsWith("mtr_");
    if (parsed.data.action === "ACCEPT") {
      const result = isRawToken
        ? await acceptInvitation(token, session.user)
        : await acceptInvitationById(token, session.user);
      return NextResponse.json(result);
    }
    if (isRawToken) {
      await declineInvitation(token, session.user);
    } else {
      await declineInvitationById(token, session.user);
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "mentor/invitations/[token]");
  }
}
