"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { CalendarDays, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { CalendarPopup } from "@/components/ui/calendar-popup"
import { parseLocalDate, parseLocalTime } from "@/lib/date-picker"

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
 * DateField: the single date entry point of the app (16 usages: trade
 * form, quick trade, trade detail, trades filters, journal, annotations,
 * period editor, rules, accounts, share dialog, custom fields).
 *
 * The trigger is a button that looks like the old native input (h-10,
 * rounded-md border, font-mono tabular-nums) and opens the real calendar
 * popup (CalendarPopup) built to the reference design: dark card, month
 * navigation, week starting Monday, emerald selected day, time input and
 * "Now" button for datetime-local. Clicking outside or pressing Escape
 * closes the popup and returns focus to the trigger.
 *
 * Same props and API as before, so no view needed changes: value stays a
 * local string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm") and conversion to
 * ISO stays with the caller (isoToLocalInput / localInputToIso), never
 * inside this component. The clear (x) button restores what the native
 * input allowed: emptying an optional field such as a From/To filter.
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
  const t = useTranslations("datePicker")
  const [open, setOpen] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [open ])

  // Close on Escape anywhere (the popup also handles it on the grid).
  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open ])

  function displayValue(): string {
    const parsed = parseLocalDate(value)
    if (!parsed) return value
    const date = new Date(parsed.year, parsed.month - 1, parsed.day)
    if (type === "datetime-local") {
      const time = parseLocalTime(value)
      if (time) date.setHours(time.hours, time.minutes)
      return new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    }
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
    }).format(date)
  }

  const placeholder = type === "datetime-local" ? t("selectDateTime") : t("selectDate")

  const trigger = (
    <div
      ref={wrapperRef}
      className={cn(
        "relative flex h-10 w-full items-center gap-1 rounded-md border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none transition-colors focus-within:outline-2 focus-within:outline-emerald-600 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-slot="date-field"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center justify-start truncate text-left outline-none disabled:cursor-not-allowed"
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value ? displayValue() : placeholder}
        </span>
      </button>
      {value && !disabled ? (
        <button
          type="button"
          aria-label={t("clear")}
          onClick={() => onChange("")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      <CalendarDays
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      {open && !disabled ? (
        <CalendarPopup
          value={value}
          type={type}
          min={min}
          max={max}
          onSelect={onChange}
          onClose={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
        />
      ) : null}
    </div>
  )

  if (!label) return trigger
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {trigger}
    </div>
  )
}

export { DateField }
