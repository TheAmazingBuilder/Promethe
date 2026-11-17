"use client";

/**
 * v2.5 Module 8 — TimeProvider (§3.4).
 *
 * Owns the time slice of UserDisplayPreference: extra timezones (max 3),
 * clock format, week start and the trading-day definition. The server row
 * is the source of truth (GET/PUT /api/display-preferences, partial
 * patches — same pattern as the a11y and privacy providers). Before the
 * first load the defaults apply (MIDNIGHT_LOCAL = the previous behaviour),
 * so the journal/calendar "today" never blocks on the network and never
 * flashes a different day once the row arrives (defaults match the
 * server defaults).
 *
 * Exposes `tradingDayOf()` so every client "today" (journal, calendar,
 * header clock) uses the same definition as the server aggregations.
 */
import * as React from "react";
import { useSession } from "@/components/app/session-context";
import { apiFetch } from "@/lib/api-client";
import type { ExtraTimezone } from "@/lib/time/broker-time";
import {
  DEFAULT_TRADING_DAY,
  getTradingDay,
  type TradingDaySettings,
} from "@/lib/time/trading-day";
import type { ClockFormat } from "@/lib/time/zones";

export interface TimePreferences {
  extraTimezones: ExtraTimezone[];
  timeFormat: ClockFormat;
  weekStartsOn: 0 | 1 | 6;
  tradingDay: TradingDaySettings;
}

export const DEFAULT_TIME_PREFERENCES: TimePreferences = {
  extraTimezones: [],
  timeFormat: "LOCALE",
  weekStartsOn: 1,
  tradingDay: DEFAULT_TRADING_DAY,
};

interface TimeContextValue {
  preferences: TimePreferences;
  /** The user's main timezone (profile), "UTC" while the session loads. */
  timezone: string;
  /** The TRADING day (YYYY-MM-DD) containing `instant` (default: now). */
  tradingDayOf: (instant?: Date) => string;
  /** Partial save of the time slice (optimistic local update + PUT). */
  set: (patch: Partial<TimePreferences>) => Promise<void>;
  /** True once the server row has been read (or the fetch failed). */
  loaded: boolean;
}

const TimeContext = React.createContext<TimeContextValue | null>(null);

function normalizeTimePreferences(
  row: Record<string, unknown>
): TimePreferences {
  const extra = Array.isArray(row.extraTimezones)
    ? (row.extraTimezones as ExtraTimezone[])
        .filter(
          (z) =>
            z != null &&
            typeof z.label === "string" &&
            typeof z.ianaTimezone === "string"
        )
        .slice(0, 3)
    : [];
  const tradingDay = (row.tradingDay ?? {}) as Record<string, unknown>;
  const mode =
    tradingDay.mode === "NEW_YORK_CLOSE" || tradingDay.mode === "CUSTOM"
      ? tradingDay.mode
      : "MIDNIGHT_LOCAL";
  return {
    extraTimezones: extra,
    timeFormat:
      row.timeFormat === "12H" || row.timeFormat === "24H"
        ? row.timeFormat
        : "LOCALE",
    weekStartsOn:
      row.weekStartsOn === 0 || row.weekStartsOn === 6 ? row.weekStartsOn : 1,
    tradingDay: {
      mode,
      rolloverTime:
        typeof tradingDay.rolloverTime === "string"
          ? tradingDay.rolloverTime
          : null,
      rolloverTimezone:
        typeof tradingDay.rolloverTimezone === "string"
          ? tradingDay.rolloverTimezone
          : null,
    },
  };
}

export function TimeProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [preferences, setPreferences] = React.useState<TimePreferences>(
    DEFAULT_TIME_PREFERENCES
  );
  const [loaded, setLoaded] = React.useState(false);
  const prefsRef = React.useRef(preferences);
  prefsRef.current = preferences;

  const timezone = session?.profile.timezone ?? "UTC";

  // Load the server row once per session.
  const sessionKey = session?.user.id ?? null;
  React.useEffect(() => {
    if (sessionKey == null) {
      setLoaded(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ preferences: Record<string, unknown> }>(
      "/api/display-preferences"
    )
      .then((payload) => {
        if (cancelled) return;
        setPreferences(normalizeTimePreferences(payload.preferences));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Offline / expired session: keep the defaults, never block the UI.
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  const tradingDayOf = React.useCallback(
    (instant: Date = new Date()): string =>
      getTradingDay(instant, timezone, prefsRef.current.tradingDay),
    [timezone]
  );

  const set = React.useCallback(async (patch: Partial<TimePreferences>) => {
    const previous = prefsRef.current;
    const next: TimePreferences = { ...previous, ...patch };
    setPreferences(next);
    try {
      const payload = await apiFetch<{ preferences: Record<string, unknown> }>(
        "/api/display-preferences",
        { method: "PUT", body: JSON.stringify(patch) }
      );
      setPreferences(normalizeTimePreferences(payload.preferences));
    } catch {
      // Revert on failure — the server row stays the source of truth.
      setPreferences(previous);
      throw new Error("time-save-failed");
    }
  }, []);

  const value = React.useMemo<TimeContextValue>(
    () => ({ preferences, timezone, tradingDayOf, set, loaded }),
    [preferences, timezone, tradingDayOf, set, loaded]
  );

  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>;
}

export function useTimePrefs(): TimeContextValue {
  const ctx = React.useContext(TimeContext);
  if (!ctx) throw new Error("useTimePrefs must be used inside <TimeProvider>");
  return ctx;
}
