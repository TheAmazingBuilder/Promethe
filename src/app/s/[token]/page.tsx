/**
 * v3 — Public share page (NO AUTH).
 *
 * Renders a redacted trade snapshot or performance report for anyone with
 * the link. Security properties:
 *  - The raw token lives only in the URL; lookups go through its HMAC hash.
 *  - Invalid / expired / revoked / view-limited links all render the SAME
 *    generic "gone" page (no probing signal).
 *  - Hidden fields are structurally ABSENT from the payload — the render
 *    below only reads keys that exist (redaction-aware UI).
 *  - noindex: shared pages are never indexed.
 *  - Rate limited per token hash and per IP (hashed, never stored raw).
 *
 * No client JS required: everything renders server-side (works with JS off).
 */
import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import {
  resolveShareLink,
  countShareViewByRawToken,
} from "@/server/sharing";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, hashIp, hashToken } from "@/lib/tokens";
import { MESSAGES } from "@/i18n/dictionaries";
import { DEFAULT_LOCALE, intlLocale, type AppLocale } from "@/i18n/config";
import type {
  PublicReportPayload,
  PublicSharePayload,
  PublicTradePayload,
} from "@/lib/sharing/types";
import { TrendingDown, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

// ── English only (Phase 3): no ?lang= parameter, no locale resolution ──────

/** Deduped resolution - generateMetadata and the page share ONE call. */
const resolve = cache((token: string) =>
  resolveShareLink(token, { countView: false })
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const result = await resolve(token);
  const title =
    result.ok && result.payload.title
      ? `${result.payload.title} - Promethe`
      : "Promethe - Shared link";
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function SharedPage({ params }: PageProps) {
  const { token } = await params;
  const locale = DEFAULT_LOCALE;
  const m = MESSAGES[locale].publicShare;

  // ── rate limits (hashed keys only) ──
  const reqHeaders = await headers();
  const ipLimit = await consumeRateLimit(
    `share:page:ip:${hashIp(clientIpFrom(reqHeaders))}`,
    120,
    60 * 60 * 1000
  );
  const tokenLimit = ipLimit.allowed
    ? await consumeRateLimit(`share:page:token:${hashToken(token)}`, 240, 60 * 60 * 1000)
    : { allowed: false };
  const result = tokenLimit.allowed
    ? await resolve(token)
    : ({ ok: false } as Awaited<ReturnType<typeof resolve>>);

  if (!result.ok) {
    return <GoneView m={m} locale={locale} />;
  }

  // Count the view exactly once per HTML navigation.
  await countShareViewByRawToken(token);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {result.payload.kind === "TRADE" ? (
          <TradeView payload={result.payload} locale={locale} m={m} />
        ) : (
          <ReportView payload={result.payload} locale={locale} m={m} />
        )}
      </main>
      <footer className="mt-auto border-t bg-card/40">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-1 px-4 py-5 text-center sm:px-6">
          <p className="text-xs text-muted-foreground">{m.sharedVia}</p>
          <p className="text-[11px] text-muted-foreground/70">{m.footerNote}</p>
        </div>
      </footer>
    </div>
  );
}

// ── GONE view ────────────────────────────────────────────────────────────────

function GoneView({ m, locale }: { m: (typeof MESSAGES)["en"]["publicShare"]; locale: AppLocale }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border bg-card">
          <span className="text-2xl" aria-hidden="true">🔒</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{m.goneTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{m.goneBody}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">{m.gonePrivacy}</p>
        <Link
          href="/"
          className="mt-6 rounded-lg border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          {m.goneCta}
        </Link>
      </main>
      <footer className="mt-auto border-t bg-card/40">
        <div className="mx-auto max-w-md px-4 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Promethe - trading journal
          </p>
        </div>
      </footer>
    </div>
  );
}

// ── formatting helpers (explicit locale — no mutable module state) ──────────

function nf(locale: AppLocale, digits = 2, signed = false) {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
    ...(signed ? { signDisplay: "always" } : {}),
  });
}

function fmtNum(locale: AppLocale, value: unknown, digits = 2, signed = false): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  return nf(locale, digits, signed).format(n);
}

function fmtDate(locale: AppLocale, iso: unknown): string {
  if (typeof iso !== "string") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
}

function fmtDateTime(locale: AppLocale, iso: unknown): string {
  if (typeof iso !== "string") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
}

function pnlTone(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

/** Reads a possibly-absent string (redaction = key missing). */
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── shared header / badges ───────────────────────────────────────────────────

function ViewHeader({
  title,
  payload,
  m,
  locale,
}: {
  title: string;
  payload: PublicSharePayload;
  m: (typeof MESSAGES)["en"]["publicShare"];
  locale: AppLocale;
}) {
  return (
    <header className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {payload.mode === "LIVE" ? `● ${m.liveBadge}` : `▣ ${m.snapshotBadge}`}
        </span>
        {payload.policy.hideAmounts && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            {m.hiddenBadge}
          </span>
        )}
      </div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      <p className="text-xs text-muted-foreground">
        {payload.mode === "LIVE" ? m.liveHint : m.snapshotHint} ·{" "}
        {m.capturedAt.replace("{date}", fmtDateTime(locale, payload.capturedAt))}
      </p>
    </header>
  );
}

// ── TRADE view ───────────────────────────────────────────────────────────────

function TradeView({
  payload,
  locale,
  m,
}: {
  payload: PublicTradePayload;
  locale: AppLocale;
  m: (typeof MESSAGES)["en"]["publicShare"];
}) {
  const t = MESSAGES[locale].trading;
  const tr = payload.trade;
  const v = m.values;

  const symbol = str(tr.symbol) ?? "-";
  const direction = str(tr.direction);
  const status = str(tr.status);
  const resultType = str(tr.resultType);
  const long = direction === "LONG";

  const entryTime = str(tr.entryTime);
  const exitTime = str(tr.exitTime);
  const timesAreDates = /^\d{4}-\d{2}-\d{2}$/.test(entryTime ?? "");

  const kpis: Array<{ label: string; value: string; tone?: string }> = [];
  if (tr.netPnl !== undefined) {
    kpis.push({
      label: v.netPnl,
      value: `${fmtNum(locale, tr.netPnl, 2, true)} ${str(tr.pnlCurrency) ?? ""}`.trim(),
      tone: pnlTone(tr.netPnl),
    });
  }
  if (tr.pips !== undefined && tr.pips !== null) {
    kpis.push({ label: v.pips, value: fmtNum(locale, tr.pips, 1, true), tone: pnlTone(tr.pips) });
  }
  if (tr.rMultiple !== undefined && tr.rMultiple !== null) {
    kpis.push({
      label: v.rMultiple,
      value: `${fmtNum(locale, tr.rMultiple, 2, true)} R`,
      tone: pnlTone(tr.rMultiple),
    });
  }
  if (tr.realizedRR !== undefined && tr.realizedRR !== null) {
    kpis.push({ label: v.realizedRR, value: fmtNum(locale, tr.realizedRR, 2), tone: pnlTone(tr.realizedRR) });
  }
  if (tr.plannedRR !== undefined && tr.plannedRR !== null) {
    kpis.push({ label: v.plannedRR, value: fmtNum(locale, tr.plannedRR, 2) });
  }

  const digits = typeof tr.digits === "number" ? tr.digits : 5;
  const fmtPrice = (x: unknown) =>
    x === null || x === undefined ? "-" : fmtNum(locale, x, digits);

  const levels: Array<[string, string]> = [
    [v.entryPrice, fmtPrice(tr.entryPrice)],
    [v.exitPrice, fmtPrice(tr.exitPrice)],
    [v.stopLoss, fmtPrice(tr.stopLoss)],
    [v.takeProfit, fmtPrice(tr.takeProfit)],
    [v.initialStop, fmtPrice(tr.initialStopLoss)],
    [v.initialTp, fmtPrice(tr.initialTakeProfit)],
    [v.mfe, fmtPrice(tr.mfePrice)],
    [v.mae, fmtPrice(tr.maePrice)],
  ];

  const meta: Array<[string, string | null]> = [
    [v.account, str(tr.accountName)],
    [v.strategy, str(tr.strategyName)],
    [v.sessionLabel, str(tr.session) ? t.session[str(tr.session) as keyof typeof t.session] ?? null : null],
    [v.timeframe, str(tr.timeframe)],
    [v.orderType, str(tr.orderType) ? t.orderType[str(tr.orderType) as keyof typeof t.orderType] ?? null : null],
    [v.setupType, str(tr.setupType)],
    [v.marketCondition, str(tr.marketCondition) ? t.marketCondition[str(tr.marketCondition) as keyof typeof t.marketCondition] ?? null : null],
    [v.exitReason, str(tr.exitReason) ? t.exitReason[str(tr.exitReason) as keyof typeof t.exitReason] ?? null : null],
  ].filter((row): row is [string, string] => row[1] !== null);

  const journal: Array<[string, string]> = (
    [
      [v.notes, str(tr.notes)],
      [v.preTradeAnalysis, str(tr.preTradeAnalysis)],
      [v.postTradeReview, str(tr.postTradeReview)],
      [v.lessonLearned, str(tr.lessonLearned)],
    ] as Array<[string, string | null]>
  ).filter((row): row is [string, string] => row[1] !== null);

  const psychology: Array<[string, string]> = (
    [
      [v.emotionBefore, str(tr.emotionBefore) ? t.emotion[str(tr.emotionBefore) as keyof typeof t.emotion] ?? null : null],
      [v.emotionDuring, str(tr.emotionDuring) ? t.emotion[str(tr.emotionDuring) as keyof typeof t.emotion] ?? null : null],
      [v.emotionAfter, str(tr.emotionAfter) ? t.emotion[str(tr.emotionAfter) as keyof typeof t.emotion] ?? null : null],
      [v.confidence, tr.confidence != null ? `${fmtNum(locale, tr.confidence, 0)} / 10` : null],
      [v.setupQualityRating, tr.setupQualityRating != null ? `${fmtNum(locale, tr.setupQualityRating, 0)} / 10` : null],
      [v.executionRating, tr.executionRating != null ? `${fmtNum(locale, tr.executionRating, 0)} / 10` : null],
      [v.followedPlan, tr.followedPlan === true ? "✔" : tr.followedPlan === false ? "✘" : null],
    ] as Array<[string, string | null]>
  ).filter((row): row is [string, string] => row[1] !== null);

  const executions = Array.isArray(tr.executions)
    ? (tr.executions as Array<Record<string, unknown>>)
    : [];
  const tags = Array.isArray(tr.tags)
    ? (tr.tags as Array<{ name?: string; color?: string }>)
    : [];

  return (
    <article className="space-y-6">
      <ViewHeader title={payload.title} payload={payload} m={m} locale={locale} />

      {/* Symbol block */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold tabular-nums">{symbol}</h2>
          {direction && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                long
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-700 dark:text-red-400"
              }`}
            >
              {long ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
              {t.direction[direction as keyof typeof t.direction] ?? direction}
            </span>
          )}
          {status && (
            <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
              {t.status[status as keyof typeof t.status] ?? status}
            </span>
          )}
          {resultType && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                resultType === "WIN"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : resultType === "LOSS"
                    ? "bg-red-500/15 text-red-700 dark:text-red-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {t.result[resultType as keyof typeof t.result] ?? resultType}
            </span>
          )}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:justify-start">
            <dt className="text-muted-foreground">{m.trade.entry}</dt>
            <dd className="tabular-nums">
              {timesAreDates
                ? fmtDate(locale, entryTime)
                : fmtDateTime(locale, entryTime)}
              {tr.entryPrice !== undefined && (
                <span className="text-muted-foreground"> · {fmtPrice(tr.entryPrice)}</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4 sm:justify-start">
            <dt className="text-muted-foreground">{m.trade.exit}</dt>
            <dd className="tabular-nums">
              {exitTime
                ? `${timesAreDates ? fmtDate(locale, exitTime) : fmtDateTime(locale, exitTime)}${
                    tr.exitPrice !== undefined
                      ? ` · ${fmtPrice(tr.exitPrice)}`
                      : ""
                  }`
                : "-"}
            </dd>
          </div>
        </dl>

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-label={m.trade.tags}>
            {tags.map((tag, i) => (
              <span
                key={i}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={tag.color ? { borderColor: `${tag.color}66` } : undefined}
              >
                {tag.name ?? ""}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* KPIs */}
      {kpis.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {kpi.label}
              </p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${kpi.tone ?? ""}`}>
                {kpi.value}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* Levels */}
      <section className="rounded-xl border bg-card p-5">
        <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {levels.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 sm:justify-start">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Meta */}
      {meta.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {meta.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 sm:justify-start">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Journal */}
      {journal.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{m.trade.journal}</h3>
          <div className="space-y-3">
            {journal.map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Psychology */}
      {psychology.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{m.trade.psychology}</h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {psychology.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Executions */}
      {executions.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{m.trade.executions}</h3>
          <ol className="space-y-2">
            {executions.map((ex, i) => {
              const type = str(ex.type);
              const typeLabel = type
                ? t.executionType[type as keyof typeof t.executionType] ?? type
                : "-";
              return (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="font-medium">{typeLabel}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {timesAreDates
                      ? fmtDate(locale, ex.time)
                      : fmtDateTime(locale, ex.time)}
                    {ex.price !== undefined && ` · ${fmtPrice(ex.price)}`}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Screenshots */}
      <section className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold">{m.trade.screenshots}</h3>
        {payload.screenshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.trade.noScreenshots}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {payload.screenshots.map((shot) => {
              const label = shot.label
                ? t.screenshotLabel[shot.label as keyof typeof t.screenshotLabel] ?? shot.label
                : null;
              return (
                <figure key={shot.id} className="space-y-1.5">
                  { }
                  <img
                    src={shot.url}
                    alt={shot.caption ?? label ?? "Screenshot"}
                    loading="lazy"
                    className="w-full rounded-lg border"
                  />
                  <figcaption className="text-xs text-muted-foreground">
                    {[label, shot.caption].filter(Boolean).join(" - ")}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </section>
    </article>
  );
}

// ── REPORT view ──────────────────────────────────────────────────────────────

function EquityChart({
  points,
  unit,
  locale,
  title,
}: {
  points: Array<{ time: string; value: number }>;
  unit: "CURRENCY" | "PERCENT" | "R";
  locale: AppLocale;
  title: string;
}) {
  if (points.length < 2) return null;
  const W = 720;
  const H = 220;
  const PAD = 8;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const last = values[values.length - 1];
  const up = last >= 0;

  return (
    <figure className="space-y-2">
      <figcaption className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-48 w-full"
        role="img"
        aria-label={title}
        preserveAspectRatio="none"
      >
        {/* zero baseline */}
        {min < 0 && max > 0 && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeDasharray="4 4"
            className="text-muted-foreground"
          />
        )}
        <path d={area} fill={up ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)"} />
        <path
          d={line}
          fill="none"
          stroke={up ? "#10b981" : "#ef4444"}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{fmtDate(locale, points[0].time)}</span>
        <span>
          {unit === "PERCENT"
            ? `${fmtNum(locale, min, 1)} % … ${fmtNum(locale, max, 1)} %`
            : unit === "R"
              ? `${fmtNum(locale, min, 2)} R … ${fmtNum(locale, max, 2)} R`
              : `${fmtNum(locale, min, 0)} … ${fmtNum(locale, max, 0)}`}
        </span>
        <span>{fmtDate(locale, points[points.length - 1].time)}</span>
      </div>
    </figure>
  );
}

function ReportView({
  payload,
  locale,
  m,
}: {
  payload: PublicReportPayload;
  locale: AppLocale;
  m: (typeof MESSAGES)["en"]["publicShare"];
}) {
  const r = m.report;
  const s = payload.stats;
  const num = (x: unknown, d = 2, signed = false) => fmtNum(locale, x, d, signed);

  const kpis: Array<{ label: string; value: string; tone?: string }> = [
    { label: r.trades, value: num(s.tradeCount, 0) },
    { label: r.winRate, value: s.winRate != null ? `${num(s.winRate, 1)} %` : "-" },
    {
      label: r.profitFactor,
      value: s.profitFactor === "Infinity" ? "∞" : s.profitFactor != null ? num(s.profitFactor, 2) : "-",
    },
    { label: r.avgR, value: s.avgR != null ? `${num(s.avgR, 2, true)} R` : "-", tone: pnlTone(s.avgR) },
    { label: r.expectancyR, value: s.expectancyR != null ? `${num(s.expectancyR, 2, true)} R` : "-", tone: pnlTone(s.expectancyR) },
  ];
  if (s.netPnl !== undefined) {
    kpis.push({ label: r.netPnl, value: num(s.netPnl, 2, true), tone: pnlTone(s.netPnl) });
  }
  if (s.totalR !== undefined && s.totalR !== null) {
    kpis.push({ label: r.totalR, value: `${num(s.totalR, 2, true)} R`, tone: pnlTone(s.totalR) });
  }
  if (s.maxDrawdown !== undefined && s.maxDrawdown !== null) {
    kpis.push({ label: r.maxDrawdown, value: num(s.maxDrawdown, 2) });
  }
  if (s.tradingDays !== undefined) {
    kpis.push({ label: r.tradingDays, value: num(s.tradingDays, 0) });
  }

  const unitTitle =
    payload.equity.unit === "PERCENT"
      ? r.unitPercent
      : payload.equity.unit === "R"
        ? r.unitR
        : r.unitCurrency;

  const renderTable = (
    rows: PublicReportPayload["byStrategy"],
    nameLabel: string
  ) => {
    if (rows.length === 0) return null;
    const showPnl = rows.some((row) => "netPnl" in row);
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">{nameLabel}</th>
            <th className="pb-2 pr-3 text-right font-medium">{r.trades}</th>
            <th className="pb-2 pr-3 text-right font-medium">{r.winRate}</th>
            {showPnl && <th className="pb-2 pr-3 text-right font-medium">{r.netPnl}</th>}
            <th className="pb-2 text-right font-medium">{r.totalR}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">{row.name}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{num(row.tradeCount, 0)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {row.winRate != null ? `${num(row.winRate, 1)} %` : "-"}
              </td>
              {showPnl && (
                <td className={`py-2 pr-3 text-right tabular-nums ${pnlTone(row.netPnl)}`}>
                  {num(row.netPnl, 2, true)}
                </td>
              )}
              <td className={`py-2 text-right tabular-nums ${pnlTone(row.totalR)}`}>
                {row.totalR != null ? `${num(row.totalR, 2, true)} R` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <article className="space-y-6">
      <ViewHeader title={payload.title} payload={payload} m={m} locale={locale} />

      <section className="rounded-xl border bg-card p-5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.period}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {fmtDate(locale, payload.period.start)} → {fmtDate(locale, payload.period.end)}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${kpi.tone ?? ""}`}>{kpi.value}</p>
          </div>
        ))}
      </section>

      {payload.equity.points.length >= 2 ? (
        <section className="rounded-xl border bg-card p-5">
          <EquityChart
            points={payload.equity.points}
            unit={payload.equity.unit}
            locale={locale}
            title={`${r.equity} (${unitTitle})`}
          />
        </section>
      ) : (
        <section className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {r.empty}
        </section>
      )}

      {payload.byStrategy.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{r.byStrategy}</h3>
          {renderTable(payload.byStrategy, r.strategy)}
        </section>
      )}

      {payload.bySymbol.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{r.bySymbol}</h3>
          {renderTable(payload.bySymbol, r.symbol)}
        </section>
      )}
    </article>
  );
}
