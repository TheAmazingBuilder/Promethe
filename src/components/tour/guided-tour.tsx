"use client";

/**
 * Guided tour - 6 steps across the app (sidebar, KPIs, quick trade, trades,
 * analytics, journal). The overlay highlights the target element and shows a
 * tooltip card; steps that live on another page navigate there first.
 *
 * Auto-starts once, on the first dashboard visit (localStorage flag).
 * Restart anytime from Settings ("Revoir la visite guidée"). Reduced motion
 * disables the smooth scrolling and the highlight glide.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigate, useRoute } from "@/lib/router";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";

const SEEN_KEY = "promethe.tour.v1";

interface TourStep {
  id: string;
  /** Clean route to navigate to before showing this step. */
  route?: string;
  /** Selectors tried in order (mobile FAB vs desktop quick action). */
  selectors: string[];
  titleKey: string;
  bodyKey: string;
}

const STEPS: TourStep[] = [
  {
    id: "nav",
    selectors: ['[data-tour="nav"]'],
    titleKey: "steps.nav.title",
    bodyKey: "steps.nav.body",
  },
  {
    id: "kpi",
    selectors: ['[data-tour="kpi"]'],
    titleKey: "steps.kpi.title",
    bodyKey: "steps.kpi.body",
  },
  {
    id: "quick-trade",
    selectors: ['[data-tour="quick-trade"]', '[data-tour="quick-trade-alt"]'],
    titleKey: "steps.quickTrade.title",
    bodyKey: "steps.quickTrade.body",
  },
  {
    id: "trades",
    route: "/trades",
    selectors: ['[data-tour="trades"]'],
    titleKey: "steps.trades.title",
    bodyKey: "steps.trades.body",
  },
  {
    id: "analytics",
    route: "/analytics",
    selectors: ['[data-tour="analytics"]'],
    titleKey: "steps.analytics.title",
    bodyKey: "steps.analytics.body",
  },
  {
    id: "journal",
    route: "/journal",
    selectors: ['[data-tour="journal"]'],
    titleKey: "steps.journal.title",
    bodyKey: "steps.journal.body",
  },
];

interface TourContextValue {
  start: () => void;
}

const TourContext = React.createContext<TourContextValue>({
  start: () => {},
});

export function useTour(): TourContextValue {
  return React.useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = React.useState<number | null>(null);
  const route = useRoute();
  const autoStarted = React.useRef(false);

  const start = React.useCallback(() => setStep(0), []);
  const stop = React.useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private mode: the tour just restarts next visit, harmless.
    }
    setStep(null);
  }, []);

  // Auto-start once, on the first dashboard visit.
  React.useEffect(() => {
    if (autoStarted.current || route.view !== "dashboard") return;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    autoStarted.current = true;
    const handle = setTimeout(() => setStep(0), 900);
    return () => clearTimeout(handle);
  }, [route.view]);

  const value = React.useMemo(() => ({ start }), [start]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {step != null && (
        <GuidedTourOverlay step={step} setStep={setStep} onDone={stop} />
      )}
    </TourContext.Provider>
  );
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT = 200;

function GuidedTourOverlay({
  step,
  setStep,
  onDone,
}: {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number | null>>;
  onDone: () => void;
}) {
  const t = useTranslations("tour");
  const { reducedMotionActive } = useA11yPrefs();
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Navigate to the step's page, then find + measure its target.
  React.useEffect(() => {
    let cancelled = false;
    setRect(null);
    if (current.route && window.location.pathname !== current.route) {
      navigate(current.route);
    }
    const find = (): HTMLElement | null => {
      for (const selector of current.selectors) {
        const el = document.querySelector(selector);
        if (el) return el as HTMLElement;
      }
      return null;
    };
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const el = find();
      if (el) {
        el.scrollIntoView({
          block: "nearest",
          behavior: reducedMotionActive ? "auto" : "smooth",
        });
        // Measure after the scroll + the 150 ms page fade.
        setTimeout(
          () => {
            if (!cancelled) setRect(el.getBoundingClientRect());
          },
          reducedMotionActive ? 50 : 350
        );
        return;
      }
      tries += 1;
      if (tries < 25) setTimeout(tick, 100);
      // Target never found: the tooltip still shows, centered, no highlight.
    };
    const start = setTimeout(tick, current.route ? 250 : 50);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [step, current, reducedMotionActive]);

  // Keep the highlight glued to its target on scroll / resize.
  React.useEffect(() => {
    if (!rect) return;
    const update = () => {
      const el = document.querySelector(current.selectors[0]);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [rect, current]);

  // Escape skips the tour.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const next = () => {
    if (isLast) onDone();
    else setStep(step + 1);
  };
  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  // Tooltip placement: below the target when it fits, above otherwise.
  let top = Math.max(8, window.innerHeight / 2 - TOOLTIP_HEIGHT / 2);
  let left = Math.max(
    8,
    Math.min(
      (window.innerWidth - TOOLTIP_WIDTH) / 2,
      window.innerWidth - TOOLTIP_WIDTH - 8
    )
  );
  if (rect) {
    const below = rect.bottom + 16;
    top =
      below + TOOLTIP_HEIGHT < window.innerHeight
        ? below
        : Math.max(8, rect.top - TOOLTIP_HEIGHT - 16);
    left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - TOOLTIP_WIDTH - 8
    );
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      {/* Highlight ring around the target */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.25)]"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            transition: reducedMotionActive
              ? undefined
              : "top 200ms ease-out, left 200ms ease-out, width 200ms ease-out, height 200ms ease-out",
          }}
          aria-hidden="true"
        />
      )}
      {/* Tooltip card */}
      <div
        className="absolute rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
        style={{ top, left, width: TOOLTIP_WIDTH }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium tabular-nums text-muted-foreground">
            {step + 1} / {STEPS.length}
          </p>
          <button
            type="button"
            onClick={onDone}
            aria-label={t("skip")}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <h3 className="mt-1 text-base font-semibold">
          {t(current.titleKey)}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(current.bodyKey)}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={prev} disabled={step === 0}>
            {t("prev")}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onDone}>
              {t("skip")}
            </Button>
            <Button size="sm" onClick={next}>
              {isLast ? t("finish") : t("next")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
