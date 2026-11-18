/**
 * Date picker logic (pure, no React) — the calendar popup in
 * src/components/ui/calendar-popup.tsx renders on top of this.
 *
 * Values are LOCAL wall-clock strings, the same contract as the native
 * inputs this replaces and as isoToLocalInput / localInputToIso in
 * src/lib/format.ts: "YYYY-MM-DD" for type="date" and
 * "YYYY-MM-DDTHH:mm" for type="datetime-local". No timezone conversion
 * happens here; conversion to ISO stays with the caller.
 *
 * Weeks start on MONDAY, matching the reference design (November 2026:
 * first row Oct 26 - Nov 1, selected day 2 in a filled pill).
 */

export type PickerDate = {
  year: number
  /** 1-12. */
  month: number
  day: number
}

export type PickerTime = {
  hours: number
  minutes: number
}

export type PickerDay = {
  /** "YYYY-MM-DD". */
  date: string
  /** Day of month, 1-31. */
  day: number
  /** False for the dimmed adjacent-month cells. */
  inMonth: boolean
  isToday: boolean
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(year, month - 1, day)
  return (
    d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
  )
}

/** "YYYY-MM-DD" (or a datetime-local value) → date parts, or null. */
export function parseLocalDate(value: string): PickerDate | null {
  if (!value) return null
  const m = DATE_RE.exec(value.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!isRealDate(year, month, day)) return null
  return { year, month, day }
}

/** "HH:mm" (or the time part of a datetime-local value) → time parts. */
export function parseLocalTime(value: string): PickerTime | null {
  if (!value) return null
  const trimmed = value.trim()
  const fromDate = DATE_RE.exec(trimmed)
  const source = fromDate && fromDate[4] ? `${fromDate[4]}:${fromDate[5]}` : trimmed
  const m = TIME_RE.exec(source)
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

export function formatLocalDate(d: PickerDate): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`
}

export function formatLocalTime(t: PickerTime): string {
  return `${pad(t.hours)}:${pad(t.minutes)}`
}

export function formatLocalDateTime(d: PickerDate, t: PickerTime): string {
  return `${formatLocalDate(d)}T${formatLocalTime(t)}`
}

export function daysInMonth(year: number, month: number): number {
  // Month is 1-based: day 0 of month M is the last day of month M.
  return new Date(year, month, 0).getDate()
}

/** Step a {year, month} pair by delta months, across year boundaries. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = (year * 12 + (month - 1) + delta) % 12
  const wrapped = ((total % 12) + 12) % 12
  const nextYear = Math.floor((year * 12 + (month - 1) + delta) / 12)
  return { year: nextYear, month: wrapped + 1 }
}

/** "November 2026" — English only, matching the app language. */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1))
}

/** Weekday header, Monday first, as in the reference design. */
export const WEEKDAY_LABELS: readonly string[] = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
]

function toDate(d: PickerDate): Date {
  return new Date(d.year, d.month - 1, d.day)
}

function fromDate(d: Date): PickerDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/**
 * The month grid: always 6 rows of 7 days, Monday first, starting with the
 * Monday of the week that holds the 1st. Adjacent-month days are included
 * (inMonth false) so the popup keeps a stable height while navigating.
 */
export function buildPickerGrid(year: number, month: number): PickerDay[][] {
  const today = todayLocalDate()
  const first = new Date(year, month - 1, 1)
  // JS getDay: 0 = Sunday. Monday-first offset: Monday 0 ... Sunday 6.
  const leadDays = (first.getDay() + 6) % 7
  const start = new Date(year, month - 1, 1 - leadDays)
  const weeks: PickerDay[][] = []
  for (let w = 0; w < 6; w++) {
    const week: PickerDay[] = []
    for (let i = 0; i < 7; i++) {
      const cell = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + w * 7 + i,
      )
      const date = formatLocalDate(fromDate(cell))
      week.push({
        date,
        day: cell.getDate(),
        inMonth: cell.getMonth() === month - 1,
        isToday: date === today,
      })
    }
    weeks.push(week)
  }
  return weeks
}

/** Today's local date as "YYYY-MM-DD". */
export function todayLocalDate(): string {
  return formatLocalDate(fromDate(new Date()))
}

/** Current local date and time as "YYYY-MM-DDTHH:mm" (the "Now" value). */
export function nowLocalDateTime(): string {
  const d = new Date()
  return formatLocalDateTime(fromDate(d), {
    hours: d.getHours(),
    minutes: d.getMinutes(),
  })
}

function datePart(value: string | undefined): string {
  if (!value) return ""
  return value.slice(0, 10)
}

/**
 * True when the day falls outside the min/max range (date part only, so a
 * datetime-local min/max still disables whole days before/after it).
 */
export function isDayDisabled(
  date: string,
  min?: string,
  max?: string,
): boolean {
  const lo = datePart(min)
  const hi = datePart(max)
  if (lo && date < lo) return true
  if (hi && date > hi) return true
  return false
}

/** Clamp a "YYYY-MM-DD" date into the min/max range (date part only). */
export function clampDateToRange(
  date: string,
  min?: string,
  max?: string,
): string {
  const lo = datePart(min)
  const hi = datePart(max)
  if (lo && date < lo) return lo
  if (hi && date > hi) return hi
  return date
}

/**
 * Keyboard focus movement on the grid. Arrow keys move by a day (Left/Right)
 * or a week (Up/Down), Home/End jump to the Monday/Sunday of the week,
 * PageUp/PageDown step a month (day clamped to the target month length).
 * Returns the new "YYYY-MM-DD" date.
 */
export function moveFocus(date: string, key: string): string {
  const parsed = parseLocalDate(date)
  if (!parsed) return date
  const d = toDate(parsed)
  switch (key) {
    case "ArrowLeft":
      d.setDate(d.getDate() - 1)
      break
    case "ArrowRight":
      d.setDate(d.getDate() + 1)
      break
    case "ArrowUp":
      d.setDate(d.getDate() - 7)
      break
    case "ArrowDown":
      d.setDate(d.getDate() + 7)
      break
    case "Home": {
      // Monday of this week.
      const offset = (d.getDay() + 6) % 7
      d.setDate(d.getDate() - offset)
      break
    }
    case "End": {
      // Sunday of this week.
      const offset = (6 - ((d.getDay() + 6) % 7)) % 7
      d.setDate(d.getDate() + offset)
      break
    }
    case "PageUp":
    case "PageDown": {
      const delta = key === "PageUp" ? -1 : 1
      const target = addMonths(d.getFullYear(), d.getMonth() + 1, delta)
      const day = Math.min(d.getDate(), daysInMonth(target.year, target.month))
      return formatLocalDate({ year: target.year, month: target.month, day })
    }
    default:
      return date
  }
  return formatLocalDate(fromDate(d))
}
