/**
 * Escape one untrusted CSV cell for spreadsheet-safe RFC 4180 output.
 * Formula-like text is prefixed before quoting so Excel/LibreOffice treat it
 * as text rather than evaluating it as a formula.
 */
export function escapeCsvField(
  value: string | number | null | undefined
): string {
  if (value == null) return "";
  const raw = String(value);
  const safe = /^[\s\u0000-\u001F\uFEFF]*[=+\-@]/.test(raw)
    ? "'" + raw
    : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
