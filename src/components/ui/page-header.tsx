import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Anchor id for the title, used by the section aria-labelledby. */
  id?: string;
  /** Page title. Icons and badges can be passed as part of the node. */
  title: ReactNode;
  /** Short description shown under the title. */
  description?: ReactNode;
  /** Extra classes for the description, e.g. a max width. */
  descriptionClassName?: string;
  /** Buttons, toggles and filters shown on the right of the title. */
  actions?: ReactNode;
  /** Extra classes for the header row, e.g. a different breakpoint. */
  className?: string;
}

/**
 * Shared page header: every view in the app uses this so page titles stay
 * uniform — one size, one weight, one description style. The title is
 * always `text-2xl font-bold tracking-tight` and the description is always
 * `text-sm text-muted-foreground` with the same spacing underneath.
 */
export function PageHeader({
  id,
  title,
  description,
  descriptionClassName,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 id={id} className="text-2xl font-bold tracking-tight">
          {title}
        </h1>
        {description != null ? (
          <div
            className={cn("text-sm text-muted-foreground", descriptionClassName)}
          >
            {description}
          </div>
        ) : null}
      </div>
      {actions != null ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
