import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { evaluateDefinitionForUser } from "@/server/custom-metrics";
import {
  metricAggregateSchema,
  metricFilterGroupSchema,
  metricFormulaSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * POST /api/custom-metrics/preview — evaluate an UNSAVED definition over the
 * user's full closed-trade history (builder "Evaluate" button). Body is the
 * definition sub-shape: { aggregate, filterGroups, formula? }.
 */

const previewSchema = z
  .object({
    aggregate: metricAggregateSchema,
    filterGroups: z.array(metricFilterGroupSchema).max(6).default([]),
    formula: metricFormulaSchema.nullable().optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const result = await evaluateDefinitionForUser(session.user.id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "custom-metrics/preview");
  }
}
