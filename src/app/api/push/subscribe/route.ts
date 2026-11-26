/**
 * POST   /api/push/subscribe - subscribe this device to Web Push.
 * DELETE /api/push/subscribe - unsubscribe this device.
 *
 * The browser PushSubscription JSON (endpoint + p256dh/auth keys) is
 * validated, then stored as one row per device (upsert on endpoint).
 * Unsubscribe deletes only the caller's own row. A subscription without
 * configured VAPID keys is refused with 503 - the UI never offers the
 * toggle in that state, but the server enforces it too.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { isPushConfigured } from "@/lib/push/vapid";
import {
  pushEndpointSchema,
  pushSubscriptionSchema,
} from "@/lib/validations/push";
import {
  subscribePush,
  unsubscribePush,
} from "@/server/push/subscriptions";

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    if (!isPushConfigured()) {
      return NextResponse.json(
        { error: "PUSH_NOT_CONFIGURED", message: "Push notifications are not configured." },
        { status: 503 }
      );
    }
    const body: unknown = await req.json().catch(() => null);
    const parsed = pushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid push subscription.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 422 }
      );
    }
    const subscription = await subscribePush(
      session.user.id,
      parsed.data,
      req.headers.get("user-agent")
    );
    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    return apiError(error, "push/subscribe");
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    const body: unknown = await req.json().catch(() => null);
    const parsed = pushEndpointSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid request." },
        { status: 422 }
      );
    }
    const removed = await unsubscribePush(session.user.id, parsed.data.endpoint);
    return NextResponse.json({ removed });
  } catch (error) {
    return apiError(error, "push/subscribe");
  }
}
