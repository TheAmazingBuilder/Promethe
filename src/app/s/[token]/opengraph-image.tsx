/**
 * v3 — OG image for public share links (1200×630, no view counting).
 *
 * Respects the link's redaction policy: amounts never appear when hidden —
 * the card shows pips / R / win rate instead. A gone/invalid token renders
 * a neutral branded card (no existence signal).
 */
import { ImageResponse } from "next/og";
import { peekShareForOg } from "@/server/sharing";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Promethe - shared link";

export default async function OgImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await peekShareForOg(token);

  const accent = "#10b981";
  const bg = "#0a0f0d";
  const card = "#111816";
  const text = "#f4f7f5";
  const muted = "#8ca39a";

  if (!payload) {
    return base(
      <div style={{ ...col, justifyContent: "center", alignItems: "center", gap: 18 }}>
        <div style={{ ...row, gap: 14, alignItems: "center" }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 30, color: "#04110b", fontWeight: 700,
          }}>P</div>
          <div style={{ fontSize: 44, fontWeight: 700, color: text }}>Promethe</div>
        </div>
        <div style={{ fontSize: 26, color: muted }}>Trading journal</div>
      </div>
    );
  }

  if (payload.kind === "TRADE") {
    const t = payload.trade;
    const symbol = typeof t.symbol === "string" ? t.symbol : "-";
    const direction = typeof t.direction === "string" ? t.direction : "";
    const pips = t.pips != null ? `${fmt(t.pips, 1)} pips` : null;
    const r = t.rMultiple != null ? `${fmt(t.rMultiple, 2)} R` : null;
    const pnl =
      payload.policy.hideAmounts || t.netPnl == null
        ? null
        : `${fmt(t.netPnl, 2)} ${typeof t.pnlCurrency === "string" ? t.pnlCurrency : ""}`;
    const tone = Number(t.netPnl ?? t.rMultiple ?? t.pips ?? 0) >= 0 ? accent : "#ef4444";

    return base(
      <div style={{ ...col, gap: 26 }}>
        <div style={{ ...row, alignItems: "center", gap: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, background: accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, color: "#04110b", fontWeight: 700,
          }}>T</div>
          <div style={{ fontSize: 30, fontWeight: 600, color: muted }}>Promethe</div>
        </div>
        <div style={{ fontSize: 64, fontWeight: 800, color: text }}>{symbol}</div>
        <div style={{ ...row, gap: 14 }}>
          <span style={{
            padding: "8px 18px", borderRadius: 999, fontSize: 26, fontWeight: 600,
            background: direction === "SHORT" ? "rgba(239,68,68,0.16)" : "rgba(16,185,129,0.16)",
            color: direction === "SHORT" ? "#f87171" : "#34d399",
          }}>{direction === "SHORT" ? "SHORT" : "LONG"}</span>
          {pips && <Pill>{pips}</Pill>}
          {r && <Pill>{r}</Pill>}
        </div>
        {pnl && (
          <div style={{ fontSize: 44, fontWeight: 700, color: tone }}>{pnl}</div>
        )}
        <div style={{ fontSize: 22, color: muted }}>{truncate(payload.title, 60)}</div>
      </div>
    );
  }

  // REPORT
  const s = payload.stats;
  const trades = s.tradeCount != null ? String(s.tradeCount) : "-";
  const winRate = s.winRate != null ? `${fmt(s.winRate, 1)}%` : null;
  const totalR = s.totalR != null ? `${fmt(s.totalR, 2)} R` : null;
  const netPnl =
    payload.policy.hideAmounts || s.netPnl == null
      ? null
      : `${fmt(s.netPnl, 2)}`;
  const tone = Number(s.netPnl ?? s.totalR ?? 0) >= 0 ? accent : "#ef4444";

  return base(
    <div style={{ ...col, gap: 26 }}>
      <div style={{ ...row, alignItems: "center", gap: 16 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 12, background: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, color: "#04110b", fontWeight: 700,
        }}>T</div>
        <div style={{ fontSize: 30, fontWeight: 600, color: muted }}>Promethe</div>
      </div>
      <div style={{ fontSize: 54, fontWeight: 800, color: text }}>{truncate(payload.title, 48)}</div>
      <div style={{ ...row, gap: 18 }}>
        <Stat label="Trades" value={trades} />
        {winRate && <Stat label="Win rate" value={winRate} />}
        {totalR && <Stat label="Total R" value={totalR} tone={tone} />}
        {netPnl && <Stat label="Net P&L" value={netPnl} tone={tone} />}
      </div>
      <div style={{ fontSize: 22, color: muted }}>
        {`${payload.period.start} → ${payload.period.end}`}
      </div>
    </div>
  );
}

// ── tiny helpers ─────────────────────────────────────────────────────────────

const col: React.CSSProperties = { display: "flex", flexDirection: "column" };
const row: React.CSSProperties = { display: "flex", flexDirection: "row" };

function base(children: React.ReactNode): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0f0d",
          padding: 64,
          backgroundImage:
            "radial-gradient(circle at 85% 15%, rgba(16,185,129,0.14), transparent 45%)",
        }}
      >
        {children}
      </div>
    ),
    size
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      padding: "8px 18px", borderRadius: 999, fontSize: 26, fontWeight: 600,
      background: "rgba(255,255,255,0.07)", color: "#d7e4de",
    }}>{children}</span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{
      ...col, gap: 6, background: "#111816", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16, padding: "18px 26px",
    }}>
      <span style={{ fontSize: 20, color: "#8ca39a" }}>{label}</span>
      <span style={{ fontSize: 40, fontWeight: 700, color: tone ?? "#f4f7f5" }}>{value}</span>
    </div>
  );
}

function fmt(value: unknown, digits: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
