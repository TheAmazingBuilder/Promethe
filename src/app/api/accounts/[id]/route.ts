import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteAccount, updateAccount } from "@/server/reference";
import { accountInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/accounts/[id] · DELETE /api/accounts/[id]
 * (accounts holding trades are never deleted — archive instead).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = accountInputSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const account = await updateAccount(session.user.id, id, parsed.data);
    if (!account) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Compte introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ account });
  } catch (error) {
    return apiError(error, "accounts/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteAccount(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "TRADES_ON_ACCOUNT", message: "Ce compte contient des trades - archivage seulement." },
        { status: 422 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "accounts/[id]");
  }
}
