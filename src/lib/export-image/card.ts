/**
 * v3 — Trade card PNG export (client-side canvas, no server round-trip).
 *
 * Two modes:
 *  - normal: symbol, dates, prices, pips, R, P&L, strategy, tags
 *  - anonymous (ANONYMOUS_EXPORT_PRESET): pips & R only — no amounts, no
 *    account/broker, dates without times. Nothing in the image can be tied
 *    back to the trader or the account size.
 *
 * Pure drawing code — exported function is browser-only (uses canvas).
 */
import type { TradeDetailDTO } from "@/lib/trading/dto";

export interface ExportCardOptions {
  anonymous: boolean;
}

const W = 1200;
const H = 675;

// Palette (matches the OG card).
const C = {
  bg: "#0a0f0d",
  card: "#111816",
  line: "rgba(255,255,255,0.08)",
  text: "#f4f7f5",
  muted: "#8ca39a",
  accent: "#10b981",
  up: "#10b981",
  down: "#ef4444",
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; weight?: string; align?: CanvasTextAlign } = {}
): void {
  ctx.fillStyle = opts.color ?? C.text;
  ctx.font = `${opts.weight ?? "500"} ${opts.size ?? 24}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

function fmtNum(value: string | null | undefined, digits = 2, signed = false): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const fixed = n.toFixed(digits);
  if (!signed || n === 0) return fixed;
  return n > 0 ? `+${fixed}` : fixed;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function pill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  bg: string,
  fg: string
): number {
  ctx.font = '600 22px ui-sans-serif, system-ui, sans-serif';
  const w = ctx.measureText(label).width + 36;
  roundRect(ctx, x, y, w, 42, 21);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, label, x + 18, y + 29, { size: 22, color: fg, weight: "600" });
  return w;
}

/** Renders the trade card onto a canvas (1200×675). */
export function renderTradeCardCanvas(
  trade: TradeDetailDTO,
  options: ExportCardOptions
): HTMLCanvasElement {
  const anonymous = options.anonymous;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponible");

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const M = 56;
  const long = trade.direction === "LONG";
  const pnlN = Number(trade.netPnl ?? "0");
  const tone = pnlN > 0 ? C.up : pnlN < 0 ? C.down : C.muted;

  // Header — brand
  roundRect(ctx, M, M, 46, 46, 12);
  ctx.fillStyle = C.accent;
  ctx.fill();
  text(ctx, "T", M + 16, M + 34, { size: 26, color: "#04110b", weight: "700" });
  text(ctx, "TradeJournal", M + 62, M + 33, { size: 26, color: C.muted, weight: "600" });

  // Symbol block
  let y = M + 130;
  text(ctx, trade.symbol, M, y, { size: 68, weight: "800" });
  y += 40;

  // Badges: direction, result, anonymous
  let bx = M;
  const badgeY = y;
  bx += pill(
    ctx,
    long ? "▲ LONG" : "▼ SHORT",
    bx,
    badgeY,
    long ? "rgba(16,185,129,0.16)" : "rgba(239,68,68,0.16)",
    long ? "#34d399" : "#f87171"
  ) + 14;
  if (trade.resultType) {
    bx += pill(
      ctx,
      trade.resultType,
      bx,
      badgeY,
      "rgba(255,255,255,0.07)",
      "#d7e4de"
    ) + 14;
  }
  if (anonymous) {
    pill(ctx, "ANONYME", bx, badgeY, "rgba(245,158,11,0.15)", "#fbbf24");
  }

  y = badgeY + 86;

  // Big KPIs — pips & R always; P&L only when not anonymous
  const kpis: Array<{ label: string; value: string; color: string }> = [];
  const pips = fmtNum(trade.pips, 1, true);
  if (pips) kpis.push({ label: "PIPS", value: pips, color: tone });
  const r = fmtNum(trade.rMultiple, 2, true);
  if (r) kpis.push({ label: "R", value: `${r} R`, color: tone });
  const rr = fmtNum(trade.realizedRR, 2);
  if (rr) kpis.push({ label: "RR RÉALISÉ", value: rr, color: C.text });
  if (!anonymous) {
    const pnl = fmtNum(trade.netPnl, 2, true);
    if (pnl) {
      kpis.push({
        label: "P&L NET",
        value: `${pnl} ${trade.pnlCurrency}`,
        color: tone,
      });
    }
  }

  if (kpis.length > 0) {
    const cardW = (W - 2 * M - (kpis.length - 1) * 16) / kpis.length;
    kpis.forEach((kpi, i) => {
      const x = M + i * (cardW + 16);
      roundRect(ctx, x, y, cardW, 116, 16);
      ctx.fillStyle = C.card;
      ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.stroke();
      text(ctx, kpi.label, x + 22, y + 36, { size: 17, color: C.muted, weight: "600" });
      text(ctx, kpi.value, x + 22, y + 88, { size: 40, color: kpi.color, weight: "700" });
    });
    y += 116 + 36;
  }

  // Details card — dates (date-only when anonymous), prices, strategy
  const rows: Array<[string, string]> = [];
  rows.push(["Entrée", anonymous ? fmtDate(trade.entryTime) : `${fmtDate(trade.entryTime)} ${trade.entryTime.slice(11, 16)} UTC`]);
  if (trade.exitTime) {
    rows.push(["Sortie", anonymous ? fmtDate(trade.exitTime) : `${fmtDate(trade.exitTime)} ${trade.exitTime.slice(11, 16)} UTC`]);
  }
  rows.push(["Prix d'entrée", trade.entryPrice]);
  if (trade.exitPrice) rows.push(["Prix de sortie", trade.exitPrice]);
  if (!anonymous) {
    if (trade.strategyName) rows.push(["Stratégie", trade.strategyName]);
    if (trade.timeframe) rows.push(["Timeframe", trade.timeframe]);
  }

  const detailH = rows.length * 34 + 28;
  roundRect(ctx, M, y, W - 2 * M, detailH, 16);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.stroke();

  rows.forEach(([label, value], i) => {
    const ry = y + 24 + i * 34;
    text(ctx, label.toUpperCase(), M + 24, ry, { size: 15, color: C.muted, weight: "600" });
    text(ctx, value, W - M - 24, ry, { size: 17, align: "right" });
  });
  y += detailH + 26;

  // Tags
  const tags = (trade.tags ?? []).slice(0, 6).map((tag) => tag.name);
  if (tags.length > 0 && y < H - 80) {
    let tx = M;
    for (const tag of tags) {
      ctx.font = '500 17px ui-sans-serif, system-ui, sans-serif';
      const w = ctx.measureText(tag).width + 28;
      if (tx + w > W - M) break;
      roundRect(ctx, tx, y, w, 32, 16);
      ctx.strokeStyle = C.line;
      ctx.stroke();
      text(ctx, tag, tx + 14, y + 22, { size: 17, color: C.muted });
      tx += w + 10;
    }
    y += 32 + 22;
  }

  // Footer — watermark
  text(ctx, "TradeJournal", M, H - 34, { size: 18, color: C.muted, weight: "600" });
  const footerRight = anonymous
    ? "Montants masqués — pips & R seulement"
    : "tradejournal.app";
  text(ctx, footerRight, W - M, H - 34, { size: 16, color: C.muted, align: "right" });

  return canvas;
}

/** Renders and triggers the PNG download. */
export async function downloadTradeCardPng(
  trade: TradeDetailDTO,
  options: ExportCardOptions
): Promise<void> {
  const canvas = renderTradeCardCanvas(trade, options);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (!blob) throw new Error("Export PNG impossible");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const datePart = (trade.exitTime ?? trade.entryTime).slice(0, 10);
  link.href = url;
  link.download = `trade-${trade.symbol.replace(/[^A-Za-z0-9]/g, "")}-${datePart}${options.anonymous ? "-anonyme" : ""}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
