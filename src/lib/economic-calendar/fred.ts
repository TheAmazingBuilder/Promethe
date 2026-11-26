/**
 * FRED provider (lot 10) - official US macro release dates + actual values.
 *
 * Source: api.stlouisfed.org (St. Louis Fed). Free API key, no card:
 * fred.stlouisfed.org -> API Keys. The app works without a key: the
 * caller then reports the source NOT_CONFIGURED and never calls this.
 *
 * Calls per sync:
 * 1. fred/releases/dates (one call, the whole window) - scheduled dates
 *    for every release, with include_release_dates_with_no_data=true so
 *    future dates are included.
 * 2. Per kept release (curated map only, capped): fred/release/series
 *    (limit 1, the headline series) + fred/series/observations (latest
 *    two, only when the release date has passed) - actual + previous.
 *
 * FRED gives no forecast and no impact rating: both stay null. FRED
 * publishes dates, not times: US releases are assumed at 08:30 ET
 * (FRED_RELEASE_HOUR_ET), the standard US release time.
 *
 * Every payload is validated at runtime: a shape FRED changes, a failed
 * per-release lookup, or a timeout fails that release (or the whole
 * provider) softly - never a crash, never a stored guess.
 */

import {
  FRED_MAX_RELEASES_PER_SYNC,
  FRED_RELEASE_HOUR_ET,
  FRED_RELEASE_MINUTE_ET,
  FRED_TIMEZONE,
  mapFredRelease,
  zonedTimeToUtc,
  type NormalizedEconomicEvent,
} from "./providers";

const FRED_BASE = "https://api.stlouisfed.org/fred";
const FETCH_TIMEOUT_MS = 10_000;

export class ProviderError extends Error {
  readonly source: "FRED" | "FOREXFACTORY";
  constructor(source: "FRED" | "FOREXFACTORY", message: string) {
    super(message);
    this.name = "ProviderError";
    this.source = source;
  }
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchJson(
  fetchImpl: FetchImpl,
  url: string,
  source: "FRED" | "FOREXFACTORY",
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new ProviderError(source, `HTTP ${res.status} from ${new URL(url).hostname}`);
    }
    return (await res.json().catch(() => null)) as unknown;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      source,
      error instanceof Error ? error.message : "Provider request failed.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function dateOnly(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

interface FredReleaseDate {
  releaseId: number;
  releaseName: string;
  date: string;
}

function parseReleaseDates(payload: unknown): FredReleaseDate[] {
  if (!isRecord(payload) || !Array.isArray(payload.release_dates)) return [];
  const out: FredReleaseDate[] = [];
  for (const row of payload.release_dates) {
    if (!isRecord(row)) continue;
    const date = typeof row.date === "string" ? dateOnly(row.date) : null;
    const name = asNonEmptyString(row.release_name);
    const id = typeof row.release_id === "number" ? row.release_id : null;
    if (date && name && id != null) out.push({ releaseId: id, releaseName: name, date });
  }
  return out;
}

interface FredSeries {
  id: string;
  units: string | null;
}

function parseReleaseSeries(payload: unknown): FredSeries | null {
  if (!isRecord(payload) || !Array.isArray(payload.seriess)) return null;
  const first = payload.seriess[0];
  if (!isRecord(first)) return null;
  const id = asNonEmptyString(first.id);
  if (!id) return null;
  return { id, units: asNonEmptyString(first.units) };
}

function parseObservations(payload: unknown): Array<{ date: string; value: string | null }> {
  if (!isRecord(payload) || !Array.isArray(payload.observations)) return [];
  const out: Array<{ date: string; value: string | null }> = [];
  for (const row of payload.observations) {
    if (!isRecord(row)) continue;
    const date = typeof row.date === "string" ? dateOnly(row.date) : null;
    if (!date) continue;
    const value = typeof row.value === "string" && row.value !== "." ? row.value : null;
    out.push({ date, value });
  }
  return out;
}

export interface FredFetchResult {
  events: NormalizedEconomicEvent[];
  /** Releases seen in the window, before the curated filter. */
  seenReleases: number;
  /** Releases kept by the curated map. */
  keptReleases: number;
}

export async function fetchFredEvents(options: {
  apiKey: string;
  /** Window start, YYYY-MM-DD (inclusive). */
  from: string;
  /** Window end, YYYY-MM-DD (inclusive). */
  to: string;
  /** "Today" for the released-or-not decision (UTC date). */
  today: string;
  fetchImpl?: FetchImpl;
}): Promise<FredFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    api_key: options.apiKey,
    file_type: "json",
    realtime_start: options.from,
    realtime_end: options.to,
    include_release_dates_with_no_data: "true",
    order_by: "release_date",
    sort_order: "asc",
    limit: "1000",
  });
  const dates = parseReleaseDates(
    await fetchJson(fetchImpl, `${FRED_BASE}/releases/dates?${params}`, "FRED"),
  );

  const kept: FredReleaseDate[] = [];
  for (const row of dates) {
    if (kept.length >= FRED_MAX_RELEASES_PER_SYNC) break;
    if (mapFredRelease(row.releaseName)) kept.push(row);
  }

  const events: NormalizedEconomicEvent[] = [];
  for (const row of kept) {
    const mapping = mapFredRelease(row.releaseName);
    if (!mapping) continue;
    const scheduledAt = zonedTimeToUtc(
      row.date,
      FRED_RELEASE_HOUR_ET,
      FRED_RELEASE_MINUTE_ET,
      FRED_TIMEZONE,
    );
    let actual: string | null = null;
    let previous: string | null = null;
    let unit: string | null = null;
    if (row.date <= options.today) {
      // Released already: read the headline series for the actual value.
      // A failure here only drops the values, never the event itself.
      try {
        const seriesParams = new URLSearchParams({
          api_key: options.apiKey,
          file_type: "json",
          release_id: String(row.releaseId),
          limit: "1",
        });
        const series = parseReleaseSeries(
          await fetchJson(fetchImpl, `${FRED_BASE}/release/series?${seriesParams}`, "FRED"),
        );
        if (series) {
          unit = series.units;
          const obsParams = new URLSearchParams({
            api_key: options.apiKey,
            file_type: "json",
            series_id: series.id,
            sort_order: "desc",
            limit: "2",
            observation_start: shiftDate(row.date, -90),
          });
          const observations = parseObservations(
            await fetchJson(fetchImpl, `${FRED_BASE}/series/observations?${obsParams}`, "FRED"),
          );
          actual = observations[0]?.value ?? null;
          previous = observations[1]?.value ?? null;
        }
      } catch {
        // Values stay null; the dated event is still stored.
      }
    }
    events.push({
      externalId: `fred:${row.releaseId}:${row.date}`,
      title: mapping.title,
      currency: "USD",
      country: "US",
      impact: null,
      category: mapping.category,
      scheduledAt,
      actual,
      forecast: null,
      previous,
      unit,
    });
  }

  return { events, seenReleases: dates.length, keptReleases: kept.length };
}

/** Shift a YYYY-MM-DD date by n days (UTC calendar math). */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}
