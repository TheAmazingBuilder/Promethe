import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createAccount, listAccounts } from "@/server/reference";
import { accountInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/accounts — account selectors (incl. PROP fields).
 * POST /api/accounts — create.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const accounts = await listAccounts(session.user.id);
    return NextResponse.json({ accounts });
  } catch (error) {
    return apiError(error, "accounts");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = accountInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const account = await createAccount(session.user.id, parsed.data);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return apiError(error, "accounts");
  }
}
