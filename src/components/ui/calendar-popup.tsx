"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  addMonths,
  buildPickerGrid,
  clampDateToRange,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  isDayDisabled,
  monthLabel,
  moveFocus,
  nowLocalDateTime,
  parseLocalDate,
  parseLocalTime,
  todayLocalDate,
  WEEKDAY_LABELS,
  type PickerDate,
  type PickerTime,
} from "@/lib/date-picker"

type CalendarPopupProps = {
  /** Current field value ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm", "" when empty). */
  value: string
  type: "date" | "datetime-local"
  min?: string
  max?: string
  /** Commit a new value. The caller keeps the ISO conversion. */
  onSelect: (value: string) => void
  onClose: () => void
}

/**
 * CalendarPopup: the real calendar popup for DateField, hand-built to the
 * reference design (dark card, "November 2026" header with ‹ › arrows,
 * MON-SUN weekday row, week starting Monday, selected day in a filled
 * emerald pill, adjacent-month days dimmed, "Now" button, time input).
 *
 * The reference uses blue for the selection; the app is emerald, so the
 * pill, the today ring and the focus accents are emerald (#10B981 family),
 * never blue and never gold.
 *
 * Behaviour: date fields commit on day click and close. Datetime fields
 * commit the day immediately (keeping the current time) and stay open so
 * the time can be adjusted; "Now" fills the current date and time and
 * closes, "Done" just closes. Keyboard: arrows move the focused day,
 * Home/End jump to the week edges, PageUp/PageDown step a month,
 * Enter/Space picks the focused day, Escape closes.
 */
function CalendarPopup({
  value,
  type,
  min,
  max,
  onSelect,
  onClose,
}: CalendarPopupProps) {
  const t = useTranslations("datePicker")

  const parsed = parseLocalDate(value)
  const today = todayLocalDate()
  const initialDate = parsed ?? parseLocalDate(today)!

  const [viewYear, setViewYear] = React.useState(initialDate.year)
  const [viewMonth, setViewMonth] = React.useState(initialDate.month)
  const [focusedDate, setFocusedDate] = React.useState(
    clampDateToRange(formatLocalDate(initialDate), min, max),
  )
  const [draftTime, setDraftTime] = React.useState<PickerTime>(
    parseLocalTime(value) ?? {
      hours: new Date().getHours(),
      minutes: new Date().getMinutes(),
    },
  )

  const gridRef = React.useRef<HTMLDivElement>(null)
  const dayRefs = React.useRef(new Map<string, HTMLButtonElement>())

  const selectedDate = parsed ? formatLocalDate(parsed) : null
  const weeks = buildPickerGrid(viewYear, viewMonth)

  // When the popup opens (or the month changes via keyboard), move DOM
  // focus to the focused day so arrow keys work right away.
  React.useEffect(() => {
    dayRefs.current.get(focusedDate)?.focus()
  }, [focusedDate, viewYear, viewMonth])

  function stepMonth(delta: number) {
    const next = addMonths(viewYear, viewMonth, delta)
    setViewYear(next.year)
    setViewMonth(next.month)
  }

  function pickDay(day: PickerDate) {
    const date = formatLocalDate(day)
    if (isDayDisabled(date, min, max)) return
    setFocusedDate(date)
    if (type === "date") {
      onSelect(date)
      onClose()
      return
    }
    onSelect(formatLocalDateTime(day, draftTime))
    // Stay open: the user may still adjust the time.
  }

  function pickNow() {
    onSelect(nowLocalDateTime())
    onClose()
  }

  function pickToday() {
    const date = clampDateToRange(today, min, max)
    onSelect(date)
    onClose()
  }

  function handleTimeChange(next: string) {
    const time = parseLocalTime(next)
    if (!time) return
    setDraftTime(time)
    const base = parseLocalDate(value) ?? parseLocalDate(today)!
    onSelect(formatLocalDateTime(base, time))
  }

  function handleGridKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === "Enter" || e.key === " ") {
      const target = e.target as HTMLElement
      const date = target.getAttribute("data-date")
      if (date) {
        e.preventDefault()
        const day = parseLocalDate(date)
        if (day) pickDay(day)
      }
      return
    }
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "PageUp" ||
      e.key === "PageDown"
    ) {
      e.preventDefault()
      const next = clampDateToRange(moveFocus(focusedDate, e.key), min, max)
      const nextParsed = parseLocalDate(next)
      if (!nextParsed) return
      setFocusedDate(next)
      if (
        nextParsed.year !== viewYear ||
        nextParsed.month !== viewMonth
      ) {
        setViewYear(nextParsed.year)
        setViewMonth(nextParsed.month)
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="absolute left-0 top-full z-50 mt-2 w-[19rem] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
    >
      {/* Month header */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={t("previousMonth")}
          onClick={() => stepMonth(-1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span
          aria-live="polite"
          className="text-base font-semibold tabular-nums"
        >
          {monthLabel(viewYear, viewMonth)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={t("nextMonth")}
          onClick={() => stepMonth(1)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Weekday header, Monday first */}
      <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-medium tracking-wide text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="py-1" aria-hidden="true">
            {label}
          </span>
        ))}
      </div>

      {/* Day grid */}
      <div
        ref={gridRef}
        aria-label={monthLabel(viewYear, viewMonth)}
        onKeyDown={handleGridKeyDown}
        className="mt-1 grid grid-cols-7 gap-y-0.5"
      >
        {weeks.flat().map((cell) => {
          const disabled = isDayDisabled(cell.date, min, max)
          const selected = cell.date === selectedDate
          return (
            <button
              key={cell.date}
              ref={(el) => {
                if (el) dayRefs.current.set(cell.date, el)
                else dayRefs.current.delete(cell.date)
              }}
              type="button"
              data-date={cell.date}
              tabIndex={cell.date === focusedDate ? 0 : -1}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={new Intl.DateTimeFormat("en-CA", {
                dateStyle: "full",
              }).format(
                new Date(
                  Number(cell.date.slice(0, 4)),
                  Number(cell.date.slice(5, 7)) - 1,
                  Number(cell.date.slice(8, 10)),
                ),
              )}
              onClick={() => {
                const day = parseLocalDate(cell.date)
                if (day) pickDay(day)
              }}
              onFocus={() => setFocusedDate(cell.date)}
              className={cn(
                "flex h-9 w-full items-center justify-center rounded-lg text-sm tabular-nums outline-none transition-colors motion-safe:transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-0",
                !cell.inMonth && "text-muted-foreground/50",
                cell.isToday && !selected && "font-bold ring-1 ring-inset ring-emerald-600",
                selected && "bg-emerald-600 font-semibold text-white hover:bg-emerald-600 hover:text-white",
                disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      {/* Footer: time + Now for datetime, Today for date */}
      {type === "datetime-local" ? (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <label
            htmlFor="calendar-popup-time"
            className="shrink-0 text-xs font-medium text-muted-foreground"
          >
            {t("time")}
          </label>
          <input
            id="calendar-popup-time"
            type="time"
            value={formatLocalTime(draftTime)}
            onChange={(e) => handleTimeChange(e.target.value)}
            aria-label={t("time")}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-emerald-600"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={pickNow}
          >
            {t("now")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0"
            onClick={onClose}
          >
            {t("done")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={pickToday}
          >
            {t("today")}
          </Button>
        </div>
      )}
    </div>
  )
}

export { CalendarPopup }
