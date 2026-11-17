import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  getExposureAlertSetting,
  upsertExposureAlertSetting,
} from "@/server/tools";
import {
  exposureSettingsSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET /api/exposure-settings - singleton thresholds (null when never saved,
 *          the client then uses the defaults 2% / 5%).
 * PUT /api/exposure-settings - upsert the singleton.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const settings = await getExposureAlertSetting(session.user.id);
    return NextResponse.json({ settings });
  } catch (error) {
    return apiError(error, "exposure-settings");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = exposureSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const settings = await upsertExposureAlertSetting(session.user.id, parsed.data);
    return NextResponse.json({ settings });
  } catch (error) {
    return apiError(error, "exposure-settings");
  }
}
