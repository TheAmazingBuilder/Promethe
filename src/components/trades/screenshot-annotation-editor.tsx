"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Check,
  Loader2,
  Minus,
  Square,
  Target,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSaveScreenshotAnnotations, useScreenshotAnnotations } from "@/hooks/use-screenshot-annotations";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import type { ScreenshotAnnotation } from "@/lib/validations/screenshot-annotations";

type ScreenshotRef = {
  id: string;
  url: string;
  label: string | null;
  caption: string | null;
};

type DrawingTool = Exclude<ScreenshotAnnotation["type"], "TEXT" | "SL" | "TP">;
type Point = [number, number];
type DraftShape = {
  type: DrawingTool;
  points: [number, number, number, number];
  color: string;
};

const TOOLS: Array<{ value: DrawingTool; icon: typeof Square; key: string }> = [
  { value: "RECTANGLE", icon: Square, key: "annotationRectangle" },
  { value: "ZONE", icon: Target, key: "annotationZone" },
  { value: "LINE", icon: Minus, key: "annotationLine" },
  { value: "ARROW", icon: ArrowUpRight, key: "annotationArrow" },
];

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function annotationLabel(annotation: ScreenshotAnnotation): string {
  if (annotation.type === "SL" || annotation.type === "TP") return annotation.type;
  return annotation.text ?? annotation.type;
}

function AnnotationShape({
  annotation,
  width,
  height,
  selected,
  onSelect,
}: {
  annotation: ScreenshotAnnotation;
  width: number;
  height: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const points = annotation.points;
  const x1 = (points[0] ?? 0) * width;
  const y1 = (points[1] ?? 0) * height;
  const x2 = (points[2] ?? points[0] ?? 0) * width;
  const y2 = (points[3] ?? points[1] ?? 0) * height;
  const strokeWidth = annotation.strokeWidth + (selected ? 1.5 : 0);
  const common = {
    stroke: annotation.color,
    strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
    onClick: (event: React.MouseEvent<SVGElement>) => {
      event.stopPropagation();
      onSelect(annotation.id);
    },
    onPointerDown: (event: React.PointerEvent<SVGElement>) => {
      event.stopPropagation();
      onSelect(annotation.id);
    },
    style: { cursor: "pointer" },
  };

  if (annotation.type === "TEXT") {
    return (
      <text
        x={x1}
        y={y1}
        fill={annotation.color}
        fontSize={Math.max(14, width * 0.026)}
        fontWeight="700"
        paintOrder="stroke"
        stroke="#111827"
        strokeWidth={Math.max(2, width * 0.003)}
        strokeLinejoin="round"
        onClick={common.onClick}
        style={common.style}
      >
        {annotation.text}
      </text>
    );
  }

  if (annotation.type === "SL" || annotation.type === "TP") {
    return (
      <g onClick={common.onClick} onPointerDown={common.onPointerDown} style={common.style}>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={annotation.color}
          strokeWidth={strokeWidth}
          strokeDasharray="12 8"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={Math.max(8, Math.min(width - 48, x1 + 8))}
          y={Math.max(18, y1 - 8)}
          fill={annotation.color}
          fontSize={Math.max(14, width * 0.022)}
          fontWeight="800"
          paintOrder="stroke"
          stroke="#111827"
          strokeWidth={Math.max(2, width * 0.003)}
        >
          {annotation.text ?? annotation.type}
        </text>
      </g>
    );
  }

  if (annotation.type === "RECTANGLE" || annotation.type === "ZONE") {
    return (
      <rect
        {...common}
        x={Math.min(x1, x2)}
        y={Math.min(y1, y2)}
        width={Math.abs(x2 - x1)}
        height={Math.abs(y2 - y1)}
        fill={annotation.type === "ZONE" ? annotation.color : "transparent"}
        fillOpacity={annotation.type === "ZONE" ? annotation.fillOpacity ?? 0.18 : 0}
      />
    );
  }

  if (annotation.type === "ARROW") {
    return (
      <g onClick={common.onClick} style={common.style}>
        <defs>
          <marker id={`annotation-arrow-${annotation.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill={annotation.color} />
          </marker>
        </defs>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={annotation.color}
          strokeWidth={strokeWidth}
          markerEnd={`url(#annotation-arrow-${annotation.id})`}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  return <line {...common} x1={x1} y1={y1} x2={x2} y2={y2} />;
}

export function ScreenshotAnnotationEditor({
  screenshot,
  open,
  onOpenChange,
}: {
  screenshot: ScreenshotRef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("trades.detail");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const query = useScreenshotAnnotations(screenshot?.id ?? null);
  const save = useSaveScreenshotAnnotations();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [annotations, setAnnotations] = React.useState<ScreenshotAnnotation[]>([]);
  const [tool, setTool] = React.useState<ScreenshotAnnotation["type"]>("RECTANGLE");
  const [color, setColor] = React.useState("#f59e0b");
  const [noteText, setNoteText] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftShape | null>(null);
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    if (!open) return;
    setAnnotations(query.data?.annotations ?? []);
    setSelectedId(null);
    setDraft(null);
    setImageSize({ width: 0, height: 0 });
    setTool("RECTANGLE");
  }, [open, screenshot?.id, query.data]);

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      clamp((event.clientX - rect.left) / Math.max(rect.width, 1)),
      clamp((event.clientY - rect.top) / Math.max(rect.height, 1)),
    ];
  };

  const addAnnotation = (annotation: ScreenshotAnnotation) => {
    if (annotations.length >= 100) {
      toast({ title: t("annotationLimit"), variant: "destructive" });
      return;
    }
    setAnnotations((current) => [...current, annotation]);
    setSelectedId(annotation.id);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (imageSize.width <= 0 || imageSize.height <= 0) return;
    const [x, y] = pointFromEvent(event);
    const id = crypto.randomUUID();

    if (tool === "TEXT") {
      const text = noteText.trim();
      if (!text) return;
      addAnnotation({ id, type: "TEXT", points: [x, y], color, strokeWidth: 2, text });
      setNoteText("");
      return;
    }
    if (tool === "SL" || tool === "TP") {
      const levelColor = tool === "SL" ? "#ef4444" : "#22c55e";
      addAnnotation({
        id,
        type: tool,
        points: [0, y, 1, y],
        color: levelColor,
        strokeWidth: 2.5,
        text: tool,
      });
      return;
    }

    setSelectedId(null);
    setDraft({ type: tool, points: [x, y, x, y], color });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const [x, y] = pointFromEvent(event);
    setDraft((current) => current
      ? { ...current, points: [current.points[0], current.points[1], x, y] }
      : null);
  };

  const onPointerUp = () => {
    if (!draft) return;
    const [x1, y1, x2, y2] = draft.points;
    if (Math.hypot(x2 - x1, y2 - y1) >= 0.004) {
      addAnnotation({
        id: crypto.randomUUID(),
        type: draft.type,
        points: draft.points,
        color: draft.color,
        strokeWidth: 2.5,
        fillOpacity: draft.type === "ZONE" ? 0.18 : 0,
      });
    }
    setDraft(null);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setAnnotations((current) => current.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  };

  const onSave = async () => {
    if (!screenshot) return;
    try {
      await save.mutateAsync({ screenshotId: screenshot.id, annotations });
      toast({ title: t("annotationSaved") });
      onOpenChange(false);
    } catch (error) {
      const apiError = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          apiError?.code,
          error instanceof Error ? error.message : t("annotationError"),
        ),
        variant: "destructive",
      });
    }
  };

  if (!screenshot) return null;

  const renderDraft: ScreenshotAnnotation | null = draft ? {
    id: "draft",
    type: draft.type,
    points: draft.points,
    color: draft.color,
    strokeWidth: 2.5,
    fillOpacity: draft.type === "ZONE" ? 0.18 : 0,
  } : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("annotationTitle")}</DialogTitle>
          <DialogDescription>{t("annotationDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {TOOLS.map(({ value, icon: Icon, key }) => (
            <Button key={value} size="sm" variant={tool === value ? "default" : "outline"} onClick={() => setTool(value)}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />{t(key)}
            </Button>
          ))}
          <Button size="sm" variant={tool === "TEXT" ? "default" : "outline"} onClick={() => setTool("TEXT")}><Type className="mr-1.5 h-3.5 w-3.5" />{t("annotationText")}</Button>
          <Button size="sm" variant="outline" onClick={() => setTool("SL")}><X className="mr-1.5 h-3.5 w-3.5 text-red-500" />{t("annotationStopLoss")}</Button>
          <Button size="sm" variant="outline" onClick={() => setTool("TP")}><Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />{t("annotationTakeProfit")}</Button>
          <div className="ml-auto flex items-center gap-2">
            <Input aria-label={t("annotationColor")} type="color" className="h-8 w-10 p-1" value={color} onChange={(event) => setColor(event.target.value)} />
            <Button size="sm" variant="ghost" disabled={!annotations.length} onClick={() => { setAnnotations((current) => current.slice(0, -1)); setSelectedId(null); }}><Undo2 className="mr-1 h-3.5 w-3.5" />{t("annotationUndo")}</Button>
            <Button size="sm" variant="ghost" disabled={!selectedId} onClick={deleteSelected}><Trash2 className="mr-1 h-3.5 w-3.5" />{t("annotationDeleteSelected")}</Button>
            <Button size="sm" variant="ghost" disabled={!annotations.length} onClick={() => { setAnnotations([]); setSelectedId(null); }}>{t("annotationClear")}</Button>
          </div>
        </div>

        {tool === "TEXT" ? (
          <div className="max-w-sm">
            <Input value={noteText} onChange={(event) => setNoteText(event.target.value)} maxLength={200} placeholder={t("annotationTextPlaceholder")} />
          </div>
        ) : null}

        <div className="rounded-lg border bg-muted/20 p-2">
          {query.isLoading ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("annotationLoading")}</div>
          ) : query.isError ? (
            <p className="py-12 text-center text-sm text-destructive">{t("annotationError")}</p>
          ) : (
            <div className="flex min-h-40 items-center justify-center overflow-hidden">
              <div className="relative inline-block max-w-full">
                {/* The original screenshot is rendered unchanged; SVG is a separate overlay. */}
                <img
                  src={screenshot.url}
                  alt={screenshot.caption ?? screenshot.label ?? t("screensTitle")}
                  className="block max-h-[65vh] max-w-full rounded-md object-contain"
                  onLoad={(event) => setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })}
                />
                {imageSize.width > 0 && imageSize.height > 0 ? (
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                    className="absolute inset-0 h-full w-full touch-none"
                    role="img"
                    aria-label={t("annotationCanvas")}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => setDraft(null)}
                  >
                    {annotations.map((annotation) => (
                      <AnnotationShape
                        key={annotation.id}
                        annotation={annotation}
                        width={imageSize.width}
                        height={imageSize.height}
                        selected={selectedId === annotation.id}
                        onSelect={setSelectedId}
                      />
                    ))}
                    {renderDraft ? (
                      <AnnotationShape
                        annotation={renderDraft}
                        width={imageSize.width}
                        height={imageSize.height}
                        selected={false}
                        onSelect={() => undefined}
                      />
                    ) : null}
                  </svg>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("annotationOriginalPreserved")}</span>
          <Badge variant="outline">{annotations.length}/100</Badge>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("annotationCancel")}</Button>
          <Button onClick={() => void onSave()} disabled={query.isLoading || query.isError || save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {t("annotationSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
