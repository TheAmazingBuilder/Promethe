import type { ReactNode } from "react";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Accessible empty-state layout shared by data modules.
 * Keep copy and actions specific to the module; this component standardizes
 * the announcement semantics and the content structure.
 */
export function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={["flex flex-col items-center gap-3 text-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      {icon}
      <div className="space-y-1">
        {title}
        {description}
      </div>
      {actions}
    </div>
  );
}
