"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
  { value: "system", labelKey: "themeSystem", icon: Monitor },
] as const;

/**
 * Theme switcher — pill-shaped segmented control (light / dark / system),
 * active segment filled with a teal accent and a soft glow.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const t = useTranslations("settings");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label={t("appearance")}
      className={cn(
        "flex items-center gap-0.5 rounded-full border bg-background p-0.5",
        className
      )}
    >
      {THEME_OPTIONS.map((option) => {
        const active = mounted && theme === option.value;
        const label = t(option.labelKey);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-teal-600 text-white shadow-[0_0_10px_rgba(13,148,136,0.5)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <option.icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
