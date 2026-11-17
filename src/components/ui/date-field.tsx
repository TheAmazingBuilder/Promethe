import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

type DateFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  label?: string
  type?: "date" | "datetime-local"
  disabled?: boolean
  min?: string
  max?: string
  ariaLabel?: string
  className?: string
}

/**
 * DateField: native date / datetime-local input, Euforia style.
 *
 * Same look as Euforia: h-10 w-full rounded-md border bg-background px-3
 * font-mono text-sm tabular-nums. No custom picker, the browser input is
 * used as-is. The emerald focus outline comes from the global rules in
 * globals.css (input[type="date"]:focus-visible), so it is not repeated
 * here. The optional label renders the shadcn Label above the input.
 * Without a label the bare input is returned, so the component also fits
 * inside a Field or a custom label wrapper. Pass the raw input string to
 * onChange; conversion to ISO stays with the caller (isoToLocalInput /
 * localInputToIso), never inside this component.
 */
function DateField({
  id,
  value,
  onChange,
  label,
  type = "date",
  disabled,
  min,
  max,
  ariaLabel,
  className,
}: DateFieldProps) {
  const input = (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      min={min}
      max={max}
      aria-label={ariaLabel}
      data-slot="date-field"
      className={cn(
        "h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none transition-colors placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  )
  if (!label) return input
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {input}
    </div>
  )
}

export { DateField }
