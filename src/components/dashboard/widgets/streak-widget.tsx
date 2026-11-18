"use client";

/** streak widget - current streak big + max win / max loss streaks. */
import { Flame, Snowflake } from "lucide-react";
import { useTranslations } from "next-intl";
import { fmtNum } from "@/lib/format";
import { asStreakData } from "./types";

const EMERALD = "text-gain";
const ROSE = "text-loss";

export function StreakWidget({ data }: { data: unknown }) {
  const t = useTranslations("dashboards");
  const streak = asStreakData(data);

  const current = streak?.current ?? 0;
  const isWin = current > 0;

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div
        className={`flex items-center gap-2 ${isWin ? EMERALD : current < 0 ? ROSE : "text-muted-foreground"}`}
      >
        {isWin ? (
          <Flame className="h-6 w-6 animate-pulse" aria-hidden="true" />
        ) : current < 0 ? (
          <Snowflake className="h-6 w-6" aria-hidden="true" />
        ) : null}
        <p className="text-2xl font-bold tabular-nums sm:text-3xl">
          {isWin
            ? t("streakWinsValue", { count: current })
            : current < 0
              ? t("streakLossesValue", { count: Math.abs(current) })
              : t("streakNone")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("streaksMax", {
          wins: fmtNum(streak?.maxWin ?? 0, 0),
          losses: fmtNum(streak?.maxLoss ?? 0, 0),
        })}
      </p>
    </div>
  );
}
