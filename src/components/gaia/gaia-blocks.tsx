"use client";

/**
 * Gaïa — block rendering and editing.
 *
 * One row per block: gutter (drag handle + block menu), then the body for the
 * block type. Text blocks use an uncontrolled textarea (the cursor survives
 * autosave re-renders); external changes are synced when the field is not
 * focused. Slash commands and the "Turn into" menu live here too.
 */
import * as React from "react";
import { getCandlestickPattern } from "@/lib/gaia/patterns/catalog";
import {
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Copy,
  GripVertical,
  Info,
  Lightbulb,
  Link2,
  MoreVertical,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  GAIA_REF_META,
  gaiaRefLabel,
  safeGaiaHref,
  type GaiaBlock,
  type GaiaBlockType,
  type GaiaCalloutTone,
  type GaiaRefKind,
  type GaiaT,
} from "./gaia-shared";

// ── Block operations (implemented by the editor) ─────────────────────────────

export interface GaiaBlockOps {
  updateText: (id: string, text: string) => void;
  updateBlock: (id: string, patch: Partial<GaiaBlock>) => void;
  splitBlock: (id: string, at: number) => void;
  mergeBackward: (id: string) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  reorder: (dragId: string, targetId: string, position: "above" | "below") => void;
  focusBlock: (id: string, at: "start" | "end") => void;
  focusNeighbor: (id: string, dir: -1 | 1) => void;
  registerTextArea: (id: string, el: HTMLTextAreaElement | null) => void;
  openRefPicker: (kind: GaiaRefKind | "", sourceBlockId: string | null) => void;
  navigateToRef: (href: string) => void;
  openSlashMenu: (blockId: string, query: string, anchor: HTMLElement) => void;
  closeSlashMenu: () => void;
}

export const TEXT_BLOCK_TYPES: GaiaBlockType[] = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "bullet",
  "numbered",
  "todo",
  "quote",
  "callout",
  "code",
];

export const TURN_INTO_TYPES: GaiaBlockType[] = [...TEXT_BLOCK_TYPES];

export function blockTypeLabel(type: GaiaBlockType, t: GaiaT): string {
  if (type === "ref") return t("gaia.refKinds.note");
  return t(`gaia.blockTypes.${type}`);
}

/** Number within the current consecutive run of numbered blocks (per-section). */
export function numberedIndexFor(blocks: GaiaBlock[], index: number): number {
  let n = 0;
  for (let i = index; i >= 0; i--) {
    if (blocks[i].type !== "numbered") break;
    n++;
  }
  return n;
}

// ── Slash commands ───────────────────────────────────────────────────────────

export interface GaiaSlashItem {
  cmd: string;
  group: "Basic" | "Advanced" | "Trading";
  type: GaiaBlockType;
  refKind?: GaiaRefKind;
  label: string;
  desc: string;
}

export function slashItemsFor(t: GaiaT): GaiaSlashItem[] {
  const desc = (k: string) => t(`gaia.slash.desc.${k}`);
  const bt = (k: string) => t(`gaia.blockTypes.${k}`);
  return [
    { cmd: "text", group: "Basic", type: "paragraph", label: bt("paragraph"), desc: desc("text") },
    { cmd: "heading", group: "Basic", type: "h1", label: bt("h1"), desc: desc("heading") },
    { cmd: "h2", group: "Basic", type: "h2", label: bt("h2"), desc: desc("h2") },
    { cmd: "h3", group: "Basic", type: "h3", label: bt("h3"), desc: desc("h3") },
    { cmd: "bullet", group: "Basic", type: "bullet", label: bt("bullet"), desc: desc("bullet") },
    { cmd: "numbered", group: "Basic", type: "numbered", label: bt("numbered"), desc: desc("numbered") },
    { cmd: "todo", group: "Basic", type: "todo", label: bt("todo"), desc: desc("todo") },
    { cmd: "quote", group: "Advanced", type: "quote", label: bt("quote"), desc: desc("quote") },
    { cmd: "callout", group: "Advanced", type: "callout", label: bt("callout"), desc: desc("callout") },
    { cmd: "code", group: "Advanced", type: "code", label: bt("code"), desc: desc("code") },
    { cmd: "table", group: "Advanced", type: "table", label: bt("table"), desc: desc("table") },
    { cmd: "divider", group: "Advanced", type: "divider", label: bt("divider"), desc: desc("divider") },
    { cmd: "image", group: "Advanced", type: "image", label: bt("image"), desc: desc("image") },
    { cmd: "trade", group: "Trading", type: "ref", refKind: "TRADE", label: t("gaia.refKinds.trade"), desc: desc("trade") },
    { cmd: "strategy", group: "Trading", type: "ref", refKind: "STRATEGY", label: t("gaia.refKinds.strategy"), desc: desc("strategy") },
    { cmd: "setup", group: "Trading", type: "ref", refKind: "SETUP", label: t("gaia.refKinds.setup"), desc: desc("setup") },
    { cmd: "lesson", group: "Trading", type: "ref", refKind: "LESSON", label: t("gaia.refKinds.lesson"), desc: desc("lesson") },
    { cmd: "event", group: "Trading", type: "ref", refKind: "EVENT", label: t("gaia.refKinds.event"), desc: desc("event") },
    { cmd: "symbol", group: "Trading", type: "ref", refKind: "SYMBOL", label: t("gaia.refKinds.symbol"), desc: desc("symbol") },
    { cmd: "note", group: "Trading", type: "ref", refKind: "NOTE", label: t("gaia.refKinds.note"), desc: desc("note") },
  ];
}

/** "/xxx" at the start of a block opens the menu; following chars filter it. */
export function slashFilterOf(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text);
  return m ? (m[1] ?? "") : null;
}

export function GaiaSlashMenu({
  rect,
  items,
  activeIndex,
  onActiveChange,
  onSelect,
  onClose,
  t,
}: {
  rect: { top: number; left: number };
  items: GaiaSlashItem[];
  activeIndex: number;
  onActiveChange: (i: number) => void;
  onSelect: (item: GaiaSlashItem) => void;
  onClose: () => void;
  t: GaiaT;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  const groups: Array<"Basic" | "Advanced" | "Trading"> = ["Basic", "Advanced", "Trading"];
  let flat = -1;
  return (
    <div
      data-testid="gaia-slash-menu"
      role="listbox"
      aria-label={t("gaia.editor.slashMenuLabel")}
      className="fixed z-50 w-72 overflow-hidden rounded-lg border bg-card shadow-lg"
      style={{
        top: Math.min(rect.top, window.innerHeight - 280),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {t("gaia.dialogs.noMatch")}
          </p>
        ) : (
          groups.map((group) => {
            const groupItems = items.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t(`gaia.slash.groups.${group}`)}
                </p>
                {groupItems.map((item) => {
                  flat++;
                  const idx = flat;
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={item.cmd}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      data-testid="gaia-slash-item"
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                        active ? "bg-emerald-500/10" : ""
                      }`}
                      onMouseEnter={() => onActiveChange(idx)}
                      onClick={() => onSelect(item)}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-muted font-mono text-[11px]">
                        /{item.cmd.slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.desc}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                        {group}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
      <button type="button" className="hidden" onClick={onClose} aria-hidden="true" tabIndex={-1}>
        close
      </button>
    </div>
  );
}

// ── Text blocks ──────────────────────────────────────────────────────────────

const MARKDOWN_TRANSFORMS: Array<{
  test: (v: string) => boolean;
  type: GaiaBlockType;
  checked?: boolean;
}> = [
  { test: (v) => v === "---", type: "divider" },
  { test: (v) => v === "```", type: "code" },
  { test: (v) => v.startsWith("### "), type: "h3" },
  { test: (v) => v.startsWith("## "), type: "h2" },
  { test: (v) => v.startsWith("# "), type: "h1" },
  { test: (v) => v.startsWith("- ") || v.startsWith("* "), type: "bullet" },
  { test: (v) => v.startsWith("1. "), type: "numbered" },
  { test: (v) => v.startsWith("[] ") || v.startsWith("[ ] "), type: "todo", checked: false },
  { test: (v) => v.startsWith("> "), type: "quote" },
];

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function placeholderFor(block: GaiaBlock, t: GaiaT): string {
  switch (block.type) {
    case "bullet":
    case "numbered":
      return t("gaia.placeholders.list");
    case "todo":
      return t("gaia.placeholders.todo");
    case "quote":
      return t("gaia.placeholders.quote");
    case "callout":
      return t("gaia.placeholders.callout");
    case "code":
      return t("gaia.placeholders.code");
    case "h1":
      return t("gaia.blockTypes.h1");
    case "h2":
      return t("gaia.blockTypes.h2");
    case "h3":
      return t("gaia.blockTypes.h3");
    default:
      return t("gaia.placeholders.paragraph");
  }
}

export function TextBlockBody({
  block,
  ops,
  t,
}: {
  block: GaiaBlock;
  ops: GaiaBlockOps;
  t: GaiaT;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (el) autoResize(el);
  }, [block.type]);

  // External changes (merge, turn-into, restore) sync in when not focused.
  React.useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value !== block.text) {
      el.value = block.text;
      autoResize(el);
    }
  }, [block.text]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    autoResize(el);
    const value = el.value;
    if (block.type === "paragraph") {
      const hit = MARKDOWN_TRANSFORMS.find((tr) => tr.test(value));
      if (hit) {
        ops.updateBlock(block.id, {
          type: hit.type,
          text: "",
          checked: hit.checked,
        });
        // Uncontrolled field: clear the trigger text in the DOM directly.
        el.value = "";
        autoResize(el);
        ops.focusBlock(block.id, "end");
        ops.closeSlashMenu();
        return;
      }
    }
    const slash = slashFilterOf(value);
    if (slash !== null) {
      ops.openSlashMenu(block.id, slash, el);
    } else {
      ops.closeSlashMenu();
    }
    ops.updateText(block.id, value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
      e.preventDefault();
      if (
        el.value === "" &&
        (block.type === "bullet" || block.type === "numbered" || block.type === "todo")
      ) {
        ops.updateBlock(block.id, { type: "paragraph", checked: undefined });
        ops.focusBlock(block.id, "start");
        return;
      }
      ops.splitBlock(block.id, el.selectionStart ?? el.value.length);
      return;
    }
    if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      ops.mergeBackward(block.id);
      return;
    }
    if (e.key === "ArrowUp" && el.selectionStart === 0) {
      e.preventDefault();
      ops.focusNeighbor(block.id, -1);
      return;
    }
    if (e.key === "ArrowDown" && el.selectionStart === el.value.length) {
      e.preventDefault();
      ops.focusNeighbor(block.id, 1);
    }
  };

  const sizeCls =
    block.type === "h1"
      ? "text-2xl font-bold"
      : block.type === "h2"
        ? "text-xl font-semibold"
        : block.type === "h3"
          ? "text-lg font-semibold"
          : block.type === "code"
            ? "font-mono text-[13px] leading-normal"
            : "text-[15px] leading-relaxed";

  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        ops.registerTextArea(block.id, el);
      }}
      defaultValue={block.text}
      rows={1}
      aria-label={`${blockTypeLabel(block.type, t)} ${t("gaia.blocks.blockAria")}`}
      placeholder={placeholderFor(block, t)}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      className={`w-full resize-none overflow-hidden rounded-sm border border-transparent bg-transparent outline-none placeholder:text-muted-foreground/50 focus:border-border focus:bg-background ${sizeCls}`}
    />
  );
}

// ── Callout ──────────────────────────────────────────────────────────────────

const CALLOUT_TONES: Array<{
  tone: GaiaCalloutTone;
  icon: typeof Info;
  hue: string;
}> = [
  { tone: "info", icon: Info, hue: "#14b8a6" },
  { tone: "tip", icon: Lightbulb, hue: "#10b981" },
  { tone: "warn", icon: AlertTriangle, hue: "#f59e0b" },
  { tone: "risk", icon: ShieldAlert, hue: "#fb7185" },
];

function CalloutBlock({
  block,
  ops,
  t,
}: {
  block: GaiaBlock;
  ops: GaiaBlockOps;
  t: GaiaT;
}) {
  const tone = block.tone ?? "info";
  const active = CALLOUT_TONES.find((c) => c.tone === tone) ?? CALLOUT_TONES[0];
  return (
    <div
      data-testid="gaia-callout"
      className="flex gap-2.5 rounded-md border p-3"
      style={{
        borderColor: `color-mix(in srgb, ${active.hue} 35%, transparent)`,
        background: `color-mix(in srgb, ${active.hue} 8%, transparent)`,
      }}
    >
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <active.icon className="size-4 shrink-0" style={{ color: active.hue }} aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          {CALLOUT_TONES.map((c) => (
            <button
              key={c.tone}
              type="button"
              aria-label={`${t("gaia.blocks.calloutToneAria")} ${t(`gaia.blocks.tones.${c.tone}`)}`}
              title={t(`gaia.blocks.tones.${c.tone}`)}
              onClick={() => ops.updateBlock(block.id, { tone: c.tone })}
              className={`rounded-sm p-0.5 transition-opacity ${
                c.tone === tone ? "opacity-100" : "opacity-25 hover:opacity-70"
              }`}
            >
              <c.icon className="size-3" style={{ color: c.hue }} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <TextBlockBody block={block} ops={ops} t={t} />
      </div>
    </div>
  );
}

// ── Image ────────────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 2_000_000;

function ImageBlock({
  block,
  ops,
  t,
}: {
  block: GaiaBlock;
  ops: GaiaBlockOps;
  t: GaiaT;
}) {
  const [url, setUrl] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const loadFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        ops.updateBlock(block.id, { src: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  if (!block.src) {
    return (
      <div
        data-testid="gaia-image-empty"
        className={`rounded-md border border-dashed bg-muted/40 p-3 ${dragOver ? "border-emerald-500/60" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          loadFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="flex items-center gap-2">
          <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() !== "") {
                e.preventDefault();
                ops.updateBlock(block.id, { src: url.trim() });
                setUrl("");
              }
            }}
            placeholder={t("gaia.blocks.imageUrlPlaceholder")}
            aria-label={t("gaia.blocks.imageUrlLabel")}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => fileRef.current?.click()}
          >
            {t("gaia.blocks.upload")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <figure data-testid="gaia-image" className="overflow-hidden rounded-md border">
      <img
        src={block.src}
        alt={block.alt ?? block.caption ?? t("gaia.blocks.noteImageAlt")}
        className="max-h-96 w-full bg-muted/30 object-contain"
      />
      <figcaption className="flex items-center gap-2 border-t bg-card px-2 py-1.5">
        <Input
          defaultValue={block.caption ?? ""}
          onChange={(e) => ops.updateBlock(block.id, { caption: e.target.value })}
          placeholder={t("gaia.blocks.captionPlaceholder")}
          aria-label={t("gaia.blocks.captionLabel")}
          className="h-7 border-transparent bg-transparent text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 hover:text-loss"
          aria-label={t("gaia.blocks.removeImage")}
          title={t("gaia.blocks.removeImage")}
          onClick={() => ops.updateBlock(block.id, { src: undefined })}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </figcaption>
    </figure>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function TableBlock({
  block,
  ops,
  t,
}: {
  block: GaiaBlock;
  ops: GaiaBlockOps;
  t: GaiaT;
}) {
  const rows = block.rows ?? [
    ["", "", ""],
    ["", "", ""],
  ];
  const colCount = rows[0]?.length ?? 3;
  const setRows = (next: string[][]) => ops.updateBlock(block.id, { rows: next });
  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row, ri) =>
      ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
    );
    setRows(next);
  };
  return (
    <div data-testid="gaia-table" className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={`group/row ${ri === 0 ? "bg-muted/60" : ""}`}>
              {row.map((cell, ci) => (
                <td key={ci} className="border-b border-r border-border p-0 last:border-r-0">
                  <input
                    value={cell}
                    onChange={(e) => setCell(ri, ci, e.target.value)}
                    aria-label={
                      ri === 0
                        ? `${t("gaia.blocks.headerColumn")} ${ci + 1}`
                        : `${t("gaia.blocks.rowColumn")} ${ri} ${t("gaia.blocks.column")} ${ci + 1}`
                    }
                    placeholder="…"
                    className={`w-full min-w-24 bg-transparent px-2 py-1.5 text-[13px] outline-none ${
                      ri === 0 ? "font-semibold" : ""
                    }`}
                  />
                </td>
              ))}
              <td className="w-6 border-b border-border p-0">
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== ri))}
                  aria-label={t("gaia.blocks.deleteRow")}
                  title={t("gaia.blocks.deleteRow")}
                  className="hidden h-full w-6 items-center justify-center text-muted-foreground hover:text-loss disabled:opacity-30 group-hover/row:flex"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-1 border-t bg-card px-2 py-1">
        <button
          type="button"
          onClick={() => setRows([...rows, Array(colCount).fill("")])}
          className="h-6 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t("gaia.blocks.addRow")}
        </button>
        <button
          type="button"
          disabled={colCount >= 8}
          onClick={() => setRows(rows.map((row) => [...row, ""]))}
          className="h-6 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          {t("gaia.blocks.addColumn")}
        </button>
        <button
          type="button"
          disabled={colCount <= 1}
          onClick={() => setRows(rows.map((row) => row.slice(0, -1)))}
          className="h-6 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          {t("gaia.blocks.removeColumn")}
        </button>
      </div>
    </div>
  );
}

// ── Ref ──────────────────────────────────────────────────────────────────────

function RefBlock({
  block,
  ops,
  t,
}: {
  block: GaiaBlock;
  ops: GaiaBlockOps;
  t: GaiaT;
}) {
  if (!block.ref) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <Link2 className="size-4" aria-hidden="true" />
        <span className="flex-1">{t("gaia.blocks.missingRef")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => ops.deleteBlock(block.id)}>
          {t("gaia.blocks.remove")}
        </Button>
      </div>
    );
  }
  const meta = GAIA_REF_META[block.ref.kind];
  const Icon = meta.icon;
  const href = safeGaiaHref(block.ref.href);
  return (
    <div
      data-testid="gaia-ref-block"
      data-ref-kind={block.ref.kind}
      className="flex items-center gap-2.5 rounded-md border p-3 hover:bg-muted/40"
      style={{ borderColor: `color-mix(in srgb, ${meta.hue} 30%, transparent)` }}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-md"
        style={{ background: `color-mix(in srgb, ${meta.hue} 14%, transparent)` }}
      >
        <Icon className="size-4" style={{ color: meta.hue }} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {block.ref.label ?? gaiaRefLabel(block.ref.kind, t)}
        </span>
        {block.ref.meta ? (
          <span className="block truncate text-xs text-muted-foreground">{block.ref.meta}</span>
        ) : null}
      </span>
      {href ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0"
          data-testid="gaia-ref-open"
          onClick={() => ops.navigateToRef(href)}
        >
          {t("gaia.blocks.open")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 hover:text-loss"
        aria-label={t("gaia.blocks.removeRef")}
        title={t("gaia.blocks.removeRef")}
        onClick={() => ops.deleteBlock(block.id)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ── One block row (gutter + body + drag and drop) ────────────────────────────

export function GaiaBlockRow({
  block,
  index,
  total,
  numberedIndex,
  ops,
  dragState,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  t,
}: {
  block: GaiaBlock;
  index: number;
  total: number;
  numberedIndex: number;
  ops: GaiaBlockOps;
  dragState: { dragId: string | null; overId: string | null; position: "above" | "below" | null };
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDrop: (id: string, patternId?: string, position?: "above" | "below") => void;
  t: GaiaT;
}) {
  const isDragging = dragState.dragId === block.id;
  const showAbove = dragState.overId === block.id && dragState.position === "above";
  const showBelow = dragState.overId === block.id && dragState.position === "below";

  let body: React.ReactNode;
  switch (block.type) {
    case "divider":
      body = (
        <div className="flex items-center gap-2 py-1">
          <hr className="h-px flex-1 border-0 bg-border" />
          <button
            type="button"
            aria-label={t("gaia.blocks.deleteDivider")}
            title={t("gaia.blocks.deleteDivider")}
            onClick={() => ops.deleteBlock(block.id)}
            className="text-muted-foreground opacity-0 hover:text-loss group-hover/row:opacity-100"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      );
      break;
    case "callout":
      body = <CalloutBlock block={block} ops={ops} t={t} />;
      break;
    case "code":
      body = (
        <div className="overflow-hidden rounded-md border border-border bg-muted/60">
          <TextBlockBody block={block} ops={ops} t={t} />
        </div>
      );
      break;
    case "quote":
      body = (
        <div className="border-l-2 border-border pl-3">
          <TextBlockBody block={block} ops={ops} t={t} />
        </div>
      );
      break;
    case "bullet":
      body = (
        <div className="flex gap-2">
          <span className="flex h-8 shrink-0 items-center text-muted-foreground" aria-hidden="true">
            •
          </span>
          <div className="min-w-0 flex-1">
            <TextBlockBody block={block} ops={ops} t={t} />
          </div>
        </div>
      );
      break;
    case "numbered":
      body = (
        <div className="flex gap-2">
          <span
            className="flex h-8 shrink-0 items-center font-mono text-xs text-muted-foreground"
            aria-hidden="true"
          >
            {numberedIndex}.
          </span>
          <div className="min-w-0 flex-1">
            <TextBlockBody block={block} ops={ops} t={t} />
          </div>
        </div>
      );
      break;
    case "todo":
      body = (
        <div className="flex gap-2">
          <input
            type="checkbox"
            checked={block.checked ?? false}
            onChange={(e) => ops.updateBlock(block.id, { checked: e.target.checked })}
            data-testid="gaia-todo-check"
            aria-label={t("gaia.blocks.toggleTodo")}
            className="mt-2.5 size-3.5 shrink-0 accent-emerald-600"
          />
          <div className={`min-w-0 flex-1 ${block.checked ? "opacity-60" : ""}`}>
            <TextBlockBody block={block} ops={ops} t={t} />
          </div>
        </div>
      );
      break;
    case "table":
      body = <TableBlock block={block} ops={ops} t={t} />;
      break;
    case "image":
      body = <ImageBlock block={block} ops={ops} t={t} />;
      break;
    case "ref":
      body = <RefBlock block={block} ops={ops} t={t} />;
      break;
    case "pattern": { const pattern = block.patternId ? getCandlestickPattern(block.patternId) : null; body = pattern ? <figure className="my-2 flex max-w-sm items-center gap-4 rounded-lg border border-border bg-card p-3" data-testid="gaia-pattern-block"><img src={pattern.illustration} alt={`Illustration ${pattern.name}`} className="h-24 w-28 object-contain" /><figcaption className="min-w-0"><strong className="block text-sm">{pattern.name}</strong><span className="text-xs text-muted-foreground">{pattern.description}</span></figcaption></figure> : <p className="text-sm text-destructive">Pattern indisponible</p>; break; }
    default:
      body = <TextBlockBody block={block} ops={ops} t={t} />;
  }

  const isTextual = TEXT_BLOCK_TYPES.includes(block.type);

  return (
    <div
      data-testid="gaia-block"
      data-block-id={block.id}
      className={`group/row relative flex gap-1 ${isDragging ? "opacity-40" : ""}`}
      onDragOver={(e) => onDragOver(e, block.id)}
      onDrop={(e) => {
        e.preventDefault();
        const patternId = e.dataTransfer.getData("application/x-promethe-gaia-pattern");
        const rect = e.currentTarget.getBoundingClientRect();
        const position = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
        onDrop(block.id, patternId || undefined, position);
      }}
    >
      {showAbove ? (
        <span className="absolute inset-x-0 top-[-2px] h-0.5 bg-emerald-500" aria-hidden="true" />
      ) : null}
      {showBelow ? (
        <span className="absolute inset-x-0 bottom-[-2px] h-0.5 bg-emerald-500" aria-hidden="true" />
      ) : null}
      <div className="flex w-6 shrink-0 flex-col items-center pt-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <span
          draggable
          role="button"
          tabIndex={0}
          aria-label={t("gaia.blocks.dragReorder")}
          title={t("gaia.blocks.dragReorderTitle")}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            onDragStart(block.id);
          }}
          onDragEnd={onDragEnd}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("gaia.blocks.blockOptions")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <MoreVertical className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {isTextual ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("gaia.blocks.turnInto")}
                  <ChevronRight className="ml-auto size-3.5" aria-hidden="true" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {TURN_INTO_TYPES.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      disabled={type === block.type}
                      onClick={() => {
                        const patch: Partial<GaiaBlock> = { type, text: block.text };
                        if (type === "todo") patch.checked = false;
                        else patch.checked = undefined;
                        ops.updateBlock(block.id, patch);
                        ops.focusBlock(block.id, "end");
                      }}
                    >
                      {t("gaia.blocks.turnInto")} {blockTypeLabel(type, t)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuItem onClick={() => ops.duplicateBlock(block.id)}>
              <Copy className="size-3.5" aria-hidden="true" />
              {t("gaia.shared.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onClick={() => ops.moveBlock(block.id, -1)}>
              <ArrowUp className="size-3.5" aria-hidden="true" />
              {t("gaia.blocks.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === total - 1}
              onClick={() => ops.moveBlock(block.id, 1)}
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
              {t("gaia.blocks.moveDown")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => ops.deleteBlock(block.id)}
              className="text-loss focus:text-loss"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t("gaia.blocks.deleteBlock")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-w-0 flex-1">
        {body}
      </div>
    </div>
  );
}
