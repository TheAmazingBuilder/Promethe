import * as React from "react";

const SCORES = [1, 2, 3, 4, 5] as const;

const SCORE_LABELS: Record<"mood" | "sleep" | "discipline", string[]> = {
  mood: ["Low", "Uneven", "Balanced", "Good", "Great"],
  sleep: ["Restless", "Light", "Fair", "Good", "Rested"],
  discipline: ["Off-plan", "Weak", "Mixed", "Focused", "Excellent"],
};

export function ScorePicker({
  label,
  value,
  onChange,
  noScoreLabel,
  kind,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  noScoreLabel: string;
  kind: keyof typeof SCORE_LABELS;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  const selectedLabel = value == null ? noScoreLabel : SCORE_LABELS[kind][value - 1];

  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{selectedLabel}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={label}>
        {SCORES.map((score) => {
          const active = value === score;
          return (
            <button
              key={score}
              type="button"
              aria-label={`${label}: ${SCORE_LABELS[kind][score - 1]}`}
              aria-pressed={active}
              onClick={() => onChange(active ? null : score)}
              className={[
                "h-9 rounded-lg border text-sm font-semibold tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border/70 bg-card text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {score}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ScalePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{value == null ? "Not rated" : `${value}/5`}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={label}>
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`${label}: ${score} of 5`}
            aria-pressed={value === score}
            onClick={() => onChange(value === score ? null : score)}
            className={[
              "h-9 rounded-lg border text-sm font-semibold tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              value === score
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border/70 bg-card text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/70 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="mt-0.5 text-base font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

