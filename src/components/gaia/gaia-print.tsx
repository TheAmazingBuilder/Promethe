"use client";

/**
 * Gaïa — print dialog ("Save as PDF").
 *
 * While the dialog is open, document.body carries .printing-gaia and the
 * @media print rules in globals.css hide everything except .print-sheet,
 * so a print started anywhere else is never hijacked.
 */
import * as React from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GAIA_REF_META,
  gaiaRefLabel,
  InlineMarkdown,
  type GaiaBlock,
  type GaiaNote,
  type GaiaT,
} from "./gaia-shared";

function PrintBlock({ block, t }: { block: GaiaBlock; t: GaiaT }) {
  switch (block.type) {
    case "h1":
      return (
        <h2 className="text-lg font-bold">
          <InlineMarkdown text={block.text} />
        </h2>
      );
    case "h2":
      return (
        <h3 className="text-base font-semibold">
          <InlineMarkdown text={block.text} />
        </h3>
      );
    case "h3":
      return (
        <h4 className="text-sm font-semibold">
          <InlineMarkdown text={block.text} />
        </h4>
      );
    case "todo":
      return (
        <p className={`text-[13px] ${block.checked ? "text-muted-foreground" : ""}`}>
          <span className="font-mono">{block.checked ? "[x]" : "[ ]"}</span>{" "}
          <InlineMarkdown text={block.text} />
        </p>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-border pl-3 text-[13px] italic">
          <InlineMarkdown text={block.text} />
        </blockquote>
      );
    case "callout": {
      const tone = block.tone ?? "info";
      return (
        <div className="rounded-md border bg-muted/50 p-3 text-[13px]">
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {t(`gaia.blocks.tones.${tone}`)}
          </span>{" "}
          <InlineMarkdown text={block.text} />
        </div>
      );
    }
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-[11px]">
          {block.text}
        </pre>
      );
    case "divider":
      return <hr className="border-border" />;
    case "image":
      if (!block.src) return null;
      return (
        <figure>
          <img src={block.src} alt={block.caption ?? ""} className="max-h-72 w-full object-contain" />
          {block.caption ? (
            <figcaption className="text-center text-[12px] italic text-muted-foreground">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    case "table": {
      const rows = block.rows ?? [];
      if (rows.length === 0) return null;
      return (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-muted/60 font-semibold">
              {rows[0].map((cell, i) => (
                <th key={i} className="border border-border px-2 py-1 text-left">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-border px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "ref": {
      if (!block.ref) return null;
      const meta = GAIA_REF_META[block.ref.kind];
      return (
        <p className="rounded-md border p-2 text-[13px]">
          <span className="font-mono text-[11px] uppercase" style={{ color: meta.hue }}>
            {gaiaRefLabel(block.ref.kind, t)}
          </span>{" "}
          {block.ref.label ?? gaiaRefLabel(block.ref.kind, t)}
          {block.ref.meta ? (
            <span className="text-muted-foreground"> — {block.ref.meta}</span>
          ) : null}
        </p>
      );
    }
    default:
      return (
        <p className="text-[13px] leading-relaxed">
          <InlineMarkdown text={block.text} />
        </p>
      );
  }
}

export function NotePrintDialog({
  open,
  onOpenChange,
  note,
  folderName,
  tagNames,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: GaiaNote | null;
  folderName: string | null;
  tagNames: string[];
  t: GaiaT;
}) {
  React.useEffect(() => {
    if (!open) return;
    document.body.classList.add("printing-gaia");
    return () => document.body.classList.remove("printing-gaia");
  }, [open ]);

  const blocks = note?.blocks ?? [];

  // Group consecutive bullet / numbered blocks into real lists.
  const rendered: Array<{ key: string; node: React.ReactNode }> = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "bullet" || block.type === "numbered") {
      const kind = block.type;
      const items: GaiaBlock[] = [];
      while (i < blocks.length && blocks[i].type === kind) {
        items.push(blocks[i]);
        i++;
      }
      const List = kind === "bullet" ? "ul" : "ol";
      rendered.push({
        key: `list-${items[0].id}`,
        node: (
          <List className={kind === "bullet" ? "list-disc pl-5 text-[13px]" : "list-decimal pl-5 text-[13px]"}>
            {items.map((item) => (
              <li key={item.id}>
                <InlineMarkdown text={item.text} />
              </li>
            ))}
          </List>
        ),
      });
    } else {
      rendered.push({ key: block.id, node: <PrintBlock block={block} t={t} /> });
      i++;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] sm:max-w-3xl" data-testid="gaia-print-dialog">
        <DialogHeader>
          <DialogTitle>{t("gaia.print.title")}</DialogTitle>
          <DialogDescription>{t("gaia.print.body")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          <div
            data-testid="gaia-print-sheet"
            className="print-sheet space-y-3 rounded-xl border bg-background p-6"
          >
            <div className="flex items-start justify-between gap-3 border-b pb-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("gaia.print.sheetLabel")}
                </p>
                <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
                  {note?.icon ? `${note.icon} ` : ""}
                  {note?.title === "" || !note?.title
                    ? t("gaia.shared.untitledNote")
                    : note.title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("gaia.print.updated")}{" "}
                  {note?.updatedAt
                    ? new Date(note.updatedAt).toLocaleDateString("fr-CA")
                    : ""}
                  {folderName ? ` · ${folderName}` : ""}
                  {tagNames.length > 0 ? ` · ${tagNames.map((n) => `#${n}`).join(" ")}` : ""}
                </p>
              </div>
            </div>
            {blocks.length === 0 ? (
              <p className="text-[13px] italic text-muted-foreground">{t("gaia.print.empty")}</p>
            ) : (
              rendered.map((r) => <div key={r.key}>{r.node}</div>)
            )}
          </div>
        </div>
        <div className="no-print flex justify-end">
          <Button
            type="button"
            data-testid="gaia-print-button"
            className="bg-emerald-600 text-white hover:bg-emerald-500"
            onClick={() => {
              window.print();
              setTimeout(() => document.body.classList.remove("printing-gaia"), 400);
            }}
          >
            <Printer className="size-4" aria-hidden="true" />
            {t("gaia.print.button")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
