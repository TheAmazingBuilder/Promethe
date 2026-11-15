/**
 * GET   /api/notifications — in-app notification center feed + unread count.
 * PATCH /api/notifications — mark one ({ id }) or all ({ all: true }) read.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications";

export async function GET() {
  try {
    const session = await requireUser();
    const result = await listNotifications(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "notifications");
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    const body = (await req.json().catch(() => null)) as
      | { id?: unknown; all?: unknown }
      | null;
    if (body && typeof body.all === "boolean" && body.all) {
      const count = await markAllNotificationsRead(session.user.id);
      return NextResponse.json({ marked: count });
    }
    if (body && typeof body.id === "string") {
      const ok = await markNotificationRead(session.user.id, body.id);
      return NextResponse.json({ marked: ok ? 1 : 0 });
    }
    return NextResponse.json(
      { error: "VALIDATION", message: "Requête invalide." },
      { status: 422 }
    );
  } catch (error) {
    return apiError(error, "notifications");
  }
}
