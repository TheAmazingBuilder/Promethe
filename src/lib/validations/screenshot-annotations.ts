import { z } from "zod";

export const SCREENSHOT_ANNOTATION_TYPES = [
  "RECTANGLE",
  "ZONE",
  "LINE",
  "ARROW",
  "TEXT",
  "SL",
  "TP",
] as const;

const normalized = z.number().finite().min(0).max(1);

export const screenshotAnnotationSchema = z.object({
  id: z.string().trim().min(1).max(64),
  type: z.enum(SCREENSHOT_ANNOTATION_TYPES),
  /** Coordinates are normalized to the original image dimensions (0–1). */
  points: z.array(normalized).min(2).max(4),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  strokeWidth: z.number().finite().min(1).max(12),
  text: z.string().trim().max(200).nullable().optional(),
  fillOpacity: z.number().finite().min(0).max(0.6).optional(),
}).superRefine((annotation, ctx) => {
  const expectedPoints = annotation.type === "TEXT" ? 2 : 4;
  if (annotation.points.length !== expectedPoints) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["points"],
      message: `${annotation.type} annotations require ${expectedPoints} normalized coordinates.`,
    });
  }
  if (annotation.type === "TEXT" && !annotation.text?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["text"],
      message: "Text annotations require a non-empty label.",
    });
  }
});

export const screenshotAnnotationsInputSchema = z.array(screenshotAnnotationSchema).max(100);

export const screenshotAnnotationsDocumentSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  annotations: screenshotAnnotationsInputSchema,
});

export type ScreenshotAnnotation = z.infer<typeof screenshotAnnotationSchema>;
