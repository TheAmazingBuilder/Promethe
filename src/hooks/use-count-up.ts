import * as React from "react";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";

/**
 * Animates a decimal value from its previous value (0 on first mount) to
 * `target` over ~700 ms with an ease-out cubic. Used for KPI numbers so they
 * count up when the dashboard loads instead of appearing instantly.
 *
 * - `null` target (no data yet) stays `null`.
 * - Non-finite targets ("Infinity", e.g. a profit factor with no losing
 *   trade) are returned as-is, never animated.
 * - Reduced motion jumps straight to the target, no animation.
 */
export function useAnimatedDecimal(
  raw: string | null,
  durationMs = 700
): string | null {
  const { reducedMotionActive } = useA11yPrefs();
  const target = React.useMemo(() => {
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [raw]);

  const [value, setValue] = React.useState<number | null>(() =>
    target == null ? null : reducedMotionActive ? target : 0
  );
  const fromRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (raw != null && target == null) return; // non-finite: keep raw as-is
    if (target == null) {
      setValue(null);
      return;
    }
    if (reducedMotionActive) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      setValue(v);
      fromRef.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, raw, durationMs, reducedMotionActive]);

  if (raw == null) return null;
  if (target == null) return raw; // non-finite: display as-is ("Infinity" -> "∞")
  if (value == null) return raw;
  return String(value);
}
