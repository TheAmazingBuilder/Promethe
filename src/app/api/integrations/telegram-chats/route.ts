/**
 * POST /api/integrations/telegram-chats - discover the chats a Telegram bot
 * can see (via getUpdates) so the user can pick its chat id. Body:
 * { token }. The token is used for this single call only: never stored,
 * never logged, never returned.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { consumeRateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { validateTelegramToken } from "@/lib/integrations/validation";
import { discoverTelegramChats } from "@/server/integrations/delivery";

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    const rl = await consumeRateLimit(
      `integrations-tg-chats:${session.user.id}`,
      10,
      60 * 1000
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait a minute." },
        { status: 429 }
      );
    }
    const body = (await req.json().catch(() => null)) as {
      token?: unknown;
    } | null;
    const checked = validateTelegramToken(body?.token);
    if (!checked.ok) {
      return NextResponse.json(
        {
          error: checked.code,
          message: "Invalid Telegram bot token.",
        },
        { status: 422 }
      );
    }
    const result = await discoverTelegramChats(checked.value);
    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
          message:
            "Telegram did not respond. Check the token and send a message to the bot first.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json({ chats: result.chats });
  } catch (error) {
    return apiError(error, "integrations/telegram-chats");
  }
}
