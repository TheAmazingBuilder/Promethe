import { describe, expect, it } from "vitest";
import {
  screenshotAnnotationSchema,
  screenshotAnnotationsDocumentSchema,
  screenshotAnnotationsInputSchema,
} from "@/lib/validations/screenshot-annotations";

describe("screenshot annotation validation", () => {
  it("accepts normalized rectangle, line, text and price-level annotations", () => {
    const result = screenshotAnnotationsInputSchema.safeParse([
      { id: "zone-1", type: "ZONE", points: [0.1, 0.2, 0.8, 0.9], color: "#22c55e", strokeWidth: 2, fillOpacity: 0.18 },
      { id: "line-1", type: "ARROW", points: [0.2, 0.3, 0.7, 0.6], color: "#f59e0b", strokeWidth: 3 },
      { id: "text-1", type: "TEXT", points: [0.5, 0.4], color: "#ffffff", strokeWidth: 2, text: "Liquidity sweep" },
      { id: "sl-1", type: "SL", points: [0, 0.7, 1, 0.7], color: "#ef4444", strokeWidth: 2, text: "SL" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects out-of-range coordinates and shape/point mismatches", () => {
    expect(screenshotAnnotationSchema.safeParse({
      id: "bad", type: "RECTANGLE", points: [0, 0, 1.2, 1],
      color: "#ffffff", strokeWidth: 2,
    }).success).toBe(false);
    expect(screenshotAnnotationSchema.safeParse({
      id: "bad", type: "LINE", points: [0.1, 0.2],
      color: "#ffffff", strokeWidth: 2,
    }).success).toBe(false);
  });

  it("validates the versioned private sidecar document", () => {
    expect(screenshotAnnotationsDocumentSchema.safeParse({
      version: 1,
      updatedAt: "2026-11-23T20:00:00.000Z",
      annotations: [],
    }).success).toBe(true);
    expect(screenshotAnnotationsDocumentSchema.safeParse({
      version: 2,
      updatedAt: "2026-11-23T20:00:00.000Z",
      annotations: [],
    }).success).toBe(false);
  });
});
