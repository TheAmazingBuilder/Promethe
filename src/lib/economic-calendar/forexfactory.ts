/**
 * ForexFactory provider (lot 10) - unofficial weekly calendar feed.
 *
 * Source: https://nfs.faireconomy.media/ff_calendar_thisweek.json
 * (the feed ForexFactory itself publishes for its calendar widgets).
 * No key, no account. It is UNOFFICIAL and has no SLA: the feed can
 * change shape or go dark, so this provider validates every row and
 * fails soft - a dead feed marks the source DOWN and never blocks the
 * other sources, never crashes the sync, and never stores a guess.
 *
 * Verified feed shape (2026-11-25): an array of
 * { title, country, date, impact, forecast, previous } where date is an
 * ISO instant with its Eastern offset (e.g. 2026-11-25T08:30:00-05:00),
 * impact is Low | Medium | High | Holiday, and forecast / previous are
 * strings, empty when absent. There is NO actual value in this feed:
 * actual stays null on ForexFactory events (FRED supplies actuals).
 * "country" is really the currency code (USD, EUR, GBP, JPY, ...).
 */

import {
  buildDedupeKey,
  classifyCategory,
  type EconomicImpact,
  type NormalizedEconomicEvent,
} from "./providers";
import { fetchJson, ProviderError, type FetchImpl } from "./fred";

const FOREXFACTORY_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

function mapImpact(raw: unknown): EconomicImpact | null {
  if (typeof raw !== "string") return null;
  switch (raw.trim().toLowerCase()) {
    case "high":
      return "HIGH";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    case "holiday":
    case "non-economic":
      // A bank holiday (or a non-economic item) is a calendar entry, not a
      // market-moving release: lowest impact, still shown.
      return "LOW";
    default:
      return null;
  }
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseForexFactoryPayload(payload: unknown): NormalizedEconomicEvent[] {
  if (!Array.isArray(payload)) {
    throw new ProviderError("FOREXFACTORY", "Unexpected calendar payload: not an array.");
  }
  const events: NormalizedEconomicEvent[] = [];
  for (const row of payload) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const title = asText(record.title);
    const country = asText(record.country);
    const dateRaw = asText(record.date);
    if (!title || !country || !dateRaw) continue;
    const scheduledAt = new Date(dateRaw);
    if (Number.isNaN(scheduledAt.getTime())) continue;
    const currency = country.toUpperCase();
    events.push({
      externalId: buildDedupeKey(title, scheduledAt, currency),
      title,
      currency,
      country,
      impact: mapImpact(record.impact),
      category: classifyCategory(title),
      scheduledAt,
      actual: null,
      forecast: asText(record.forecast),
      previous: asText(record.previous),
      unit: null,
    });
  }
  return events;
}

export async function fetchForexFactoryEvents(options?: {
  fetchImpl?: FetchImpl;
}): Promise<NormalizedEconomicEvent[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const payload = await fetchJson(fetchImpl, FOREXFACTORY_URL, "FOREXFACTORY");
  return parseForexFactoryPayload(payload);
}
