import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { DashboardValidationError, importDashboards } from "@/server/dashboards";
import {
  DASHBOARD_IMPORT_MAX_BYTES,
  dashboardImportSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * POST /api/dashboards/import — raw JSON body (≤ 256 KB), Zod-validated
 * import file. Unknown widget types / invalid configs are skipped and
 * reported; the dashboard limit (8) stops the import early.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const raw = await req.text();
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > DASHBOARD_IMPORT_MAX_BYTES) {
      throw new DashboardValidationError("IMPORT_TOO_LARGE", 413);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new DashboardValidationError("IMPORT_INVALID_JSON", 422);
    }
    const parsed = dashboardImportSchema.safeParse(json);
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
    const { dashboards, skipped } = await importDashboards(
      session.user.id,
      parsed.data,
      bytes
    );
    return NextResponse.json({ dashboards, skipped });
  } catch (error) {
    return apiError(error, "dashboards/import");
  }
}
