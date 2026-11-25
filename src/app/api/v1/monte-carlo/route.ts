import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { monteCarloInputSchema } from "@/lib/validations/monte-carlo";
import { zodFieldErrors } from "@/lib/auth/validators";
import {
  createMonteCarloRun,
  listMonteCarloRuns,
  MonteCarloDataError,
} from "@/server/monte-carlo";

/** GET saved simulations; POST runs a user-scoped simulation from one account's closed trades. */
export async function GET() {
  try {
    const session = await requireUser();
    const runs = await listMonteCarloRuns(session.user.id);
    return NextResponse.json({ runs });
  } catch (error) {
    return apiError(error, "monte-carlo");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`monte-carlo:${session.user.id}`, 10, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many simulations. Please wait a moment." },
        { status: 429 },
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = monteCarloInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Simulation parameters are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const payload = await createMonteCarloRun(session.user.id, parsed.data);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    if (error instanceof MonteCarloDataError) {
      const message = error.code === "ACCOUNT_NOT_FOUND"
        ? "Account not found."
        : error.code === "MONTE_CARLO_BALANCE_INVALID"
          ? "The selected account must have a positive initial balance."
          : error.code === "MONTE_CARLO_OUTCOME_OUT_OF_RANGE"
            ? "A historical R-multiple is outside the supported range of -20R to +20R. Review the trade data before simulating."
            : error.code === "MONTE_CARLO_HYPOTHETICAL_INVALID"
              ? "Hypothetical parameters are invalid. Check the win rate and the average win and loss."
              : error.code === "MONTE_CARLO_RUIN_BEHAVIOR_INVALID"
                ? "Ruin behavior is invalid."
                : error.code === "MONTE_CARLO_INSUFFICIENT_HISTORY"
                  ? "At least five closed trades with a valid R-multiple are required."
                  : "Simulation parameters are invalid.";
      return NextResponse.json({ error: error.code, message }, { status: error.status });
    }
    return apiError(error, "monte-carlo");
  }
}
