"use client";

/**
 * AppearanceProvider (v2.5 Module 1, spec §1) — applies the user's appearance
 * row (palette / chart palette / density / custom colors) to
 * document.documentElement as data-attributes + inline CSS variables, and
 * exposes an optimistic setAppearance() for the settings views.
 *
 * Implementation note: plain fetch + React state (NOT React Query) — this
 * provider sits above the whole app tree and must update independently of
 * the query cache lifecycle.
 *
 * Logged out → no attributes (CSS defaults). Custom palette → the three
 * --gain/--loss/--neutral inline overrides; the derived -bg/-border vars in
 * globals.css recompute automatically through color-mix(var(--gain), …).
 */
import * as React from "react";
import { useSession } from "@/components/app/session-context";
import { apiFetch } from "@/lib/api-client";
import type { AppearanceInput } from "@/lib/validations/dashboard";

/** Client-side mirror of the server appearance DTO. */
export interface AppearanceDTO {
  paletteKey: string;
  gainColor: string | null;
  lossColor: string | null;
  neutralColor: string | null;
  density: string;
  chartPaletteKey: string;
  kpiDefaults: unknown;
  focusModeConfig: {
    hideAmounts?: boolean;
    blocks?: string[];
  } | null;
}

interface AppearanceContextValue {
  appearance: AppearanceDTO | null;
  /** Optimistic PUT - the DOM updates immediately, rolls back on error. */
  setAppearance: (input: AppearanceInput) => void;
  /** True while the row is being loaded (first paint). */
  isLoading: boolean;
}

const AppearanceContext = React.createContext<AppearanceContextValue | null>(
  null
);

const CUSTOM_VARS = [
  "--gain",
  "--loss",
  "--neutral",
  "--gain-fg",
  "--loss-fg",
  "--neutral-fg",
] as const;

function applyToDocumentElement(appearance: AppearanceDTO | null): void {
  const root = document.documentElement;
  if (appearance == null) {
    root.removeAttribute("data-palette");
    root.removeAttribute("data-chart-palette");
    root.removeAttribute("data-density");
    for (const name of CUSTOM_VARS) root.style.removeProperty(name);
    return;
  }

  root.setAttribute("data-palette", appearance.paletteKey);
  root.setAttribute("data-chart-palette", appearance.chartPaletteKey);
  root.setAttribute("data-density", appearance.density);

  // Custom palette: inline vars override every stylesheet rule (including
  // dark variants). Contrast of the custom hexes is checked at save time in
  // the appearance view; here -fg mirrors the chosen hex per spec.
  const isCustom = appearance.paletteKey === "custom";
  if (isCustom && appearance.gainColor && appearance.lossColor) {
    root.style.setProperty("--gain", appearance.gainColor);
    root.style.setProperty("--loss", appearance.lossColor);
    root.style.setProperty(
      "--neutral",
      appearance.neutralColor ?? appearance.gainColor
    );
    root.style.setProperty("--gain-fg", appearance.gainColor);
    root.style.setProperty("--loss-fg", appearance.lossColor);
    root.style.setProperty(
      "--neutral-fg",
      appearance.neutralColor ?? appearance.gainColor
    );
  } else {
    for (const name of CUSTOM_VARS) root.style.removeProperty(name);
  }
}

const DEFAULT_APPEARANCE: AppearanceDTO = {
  paletteKey: "default",
  gainColor: null,
  lossColor: null,
  neutralColor: null,
  density: "COMFORTABLE",
  chartPaletteKey: "default",
  kpiDefaults: {},
  focusModeConfig: null,
};

/** Server PATCH semantics applied locally for optimistic updates. */
function patchAppearance(
  previous: AppearanceDTO,
  input: AppearanceInput
): AppearanceDTO {
  return {
    ...previous,
    ...(input.paletteKey != null ? { paletteKey: input.paletteKey } : {}),
    ...(input.density != null ? { density: input.density } : {}),
    ...(input.chartPaletteKey != null
      ? { chartPaletteKey: input.chartPaletteKey }
      : {}),
    ...(input.paletteKey != null && input.paletteKey !== "custom"
      ? { gainColor: null, lossColor: null, neutralColor: null }
      : {}),
    ...(input.gainColor !== undefined ? { gainColor: input.gainColor } : {}),
    ...(input.lossColor !== undefined ? { lossColor: input.lossColor } : {}),
    ...(input.neutralColor !== undefined
      ? { neutralColor: input.neutralColor }
      : {}),
    ...(input.kpiDefaults !== undefined
      ? { kpiDefaults: input.kpiDefaults }
      : {}),
    ...(input.focusModeConfig !== undefined
      ? { focusModeConfig: input.focusModeConfig }
      : {}),
  };
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [appearance, setAppearanceState] = React.useState<AppearanceDTO | null>(
    null
  );
  const [isLoading, setIsLoading] = React.useState(true);

  // Load once per login (the row is tiny and rarely changes).
  const sessionKey = session?.user.id ?? null;
  React.useEffect(() => {
    if (sessionKey == null) {
      setAppearanceState(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    apiFetch<{ appearance: AppearanceDTO }>("/api/appearance")
      .then((payload) => {
        if (!cancelled) setAppearanceState(payload.appearance);
      })
      .catch(() => {
        if (!cancelled) setAppearanceState(DEFAULT_APPEARANCE);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  // Apply to <html> whenever the effective row changes.
  React.useEffect(() => {
    applyToDocumentElement(appearance);
  }, [appearance]);

  const setAppearance = React.useCallback(
    (input: AppearanceInput) => {
      // Optimistic local patch + best-effort persist (rollback on failure).
      setAppearanceState((previous) =>
        patchAppearance(previous ?? DEFAULT_APPEARANCE, input)
      );
      apiFetch<{ appearance: AppearanceDTO }>("/api/appearance", {
        method: "PUT",
        body: JSON.stringify(input),
      })
        .then((payload) => setAppearanceState(payload.appearance))
        .catch(() => {
          // Roll back to the server truth on failure.
          apiFetch<{ appearance: AppearanceDTO }>("/api/appearance")
            .then((payload) => setAppearanceState(payload.appearance))
            .catch(() => undefined);
        });
    },
    []
  );

  const value = React.useMemo(
    () => ({ appearance, setAppearance, isLoading }),
    [appearance, setAppearance, isLoading]
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearanceContext(): AppearanceContextValue {
  const ctx = React.useContext(AppearanceContext);
  if (!ctx) {
    throw new Error(
      "useAppearanceContext must be used inside <AppearanceProvider>"
    );
  }
  return ctx;
}
