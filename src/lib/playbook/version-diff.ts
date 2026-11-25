/**
 * Strategy snapshot comparison (Lot 11, roadmap §14).
 *
 * Versions are immutable JSON snapshots of a strategy definition. Until
 * this lot the versions dialog only listed them - there was no way to see
 * WHAT changed between two versions. This pure function diffs two parsed
 * snapshots field by field.
 *
 * Snapshots predate the extended definition fields (market conditions,
 * entry conditions, risk block, ...): those fields are simply absent on
 * old snapshots and read as null / empty here. A field that is absent on
 * one side and present on the other counts as changed only when the
 * present side is non-empty.
 */

export interface SnapshotDiffInput {
  name?: string | null;
  description?: string | null;
  status?: string | null;
  timeframes?: string[] | null;
  defaultRiskPercent?: string | null;
  targetRR?: string | null;
  entryRules?: string | null;
  exitRules?: string | null;
  riskRules?: string | null;
  detailedDescription?: string | null;
  marketConditions?: unknown[] | null;
  entryConditions?: unknown[] | null;
  confirmations?: unknown[] | null;
  invalidations?: string[] | null;
  risk?: Record<string, unknown> | null;
  tradeManagement?: unknown[] | null;
  exitPlan?: unknown[] | null;
  checklistItems?: Array<{
    label: string;
    category?: string;
    isRequired?: boolean;
  }> | null;
}

export interface SnapshotDiffRow {
  /** Stable key, e.g. "entryRules" or "checklist". */
  field: string;
  /** Short human label for the row. */
  label: string;
  /** Short display value for the older snapshot. */
  from: string;
  /** Short display value for the newer snapshot. */
  to: string;
}

const MAX_TEXT = 80;

function shortText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (text.length === 0) return "-";
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}...` : text;
}

function shortList(value: unknown[] | null | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return "-";
  return `${value.length} item${value.length === 1 ? "" : "s"}`;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function checklistSummary(
  items: SnapshotDiffInput["checklistItems"],
): string {
  const list = items ?? [];
  if (list.length === 0) return "-";
  const required = list.filter((i) => i.isRequired === true).length;
  return `${list.length} item${list.length === 1 ? "" : "s"} (${required} required)`;
}

function checklistChanged(
  a: SnapshotDiffInput["checklistItems"],
  b: SnapshotDiffInput["checklistItems"],
): boolean {
  const key = (items: SnapshotDiffInput["checklistItems"]): string =>
    JSON.stringify(
      (items ?? []).map((i) => [i.label, i.category ?? "", i.isRequired === true]),
    );
  return key(a) !== key(b);
}

/**
 * Diffs two snapshots. `a` is the older version, `b` the newer one.
 * Only changed fields are returned, oldest-first by field order below.
 */
export function diffStrategySnapshots(
  a: SnapshotDiffInput,
  b: SnapshotDiffInput,
): SnapshotDiffRow[] {
  const rows: SnapshotDiffRow[] = [];
  const push = (field: string, label: string, from: string, to: string) => {
    rows.push({ field, label, from, to });
  };

  if (!sameText(a.name, b.name)) push("name", "Name", shortText(a.name), shortText(b.name));
  if (!sameText(a.status, b.status))
    push("status", "Status", shortText(a.status), shortText(b.status));
  if (!sameJson(a.timeframes ?? [], b.timeframes ?? []))
    push("timeframes", "Timeframes", shortList(a.timeframes), shortList(b.timeframes));
  if (!sameText(a.defaultRiskPercent, b.defaultRiskPercent))
    push(
      "defaultRiskPercent",
      "Default risk %",
      shortText(a.defaultRiskPercent),
      shortText(b.defaultRiskPercent),
    );
  if (!sameText(a.targetRR, b.targetRR))
    push("targetRR", "Target R:R", shortText(a.targetRR), shortText(b.targetRR));
  if (!sameText(a.entryRules, b.entryRules))
    push("entryRules", "Entry rules", shortText(a.entryRules), shortText(b.entryRules));
  if (!sameText(a.exitRules, b.exitRules))
    push("exitRules", "Exit rules", shortText(a.exitRules), shortText(b.exitRules));
  if (!sameText(a.riskRules, b.riskRules))
    push("riskRules", "Risk rules", shortText(a.riskRules), shortText(b.riskRules));
  if (!sameText(a.detailedDescription, b.detailedDescription))
    push(
      "detailedDescription",
      "Description",
      shortText(a.detailedDescription),
      shortText(b.detailedDescription),
    );
  if (!sameJson(a.marketConditions ?? [], b.marketConditions ?? []))
    push(
      "marketConditions",
      "Market conditions",
      shortList(a.marketConditions),
      shortList(b.marketConditions),
    );
  if (!sameJson(a.entryConditions ?? [], b.entryConditions ?? []))
    push(
      "entryConditions",
      "Entry conditions",
      shortList(a.entryConditions),
      shortList(b.entryConditions),
    );
  if (!sameJson(a.confirmations ?? [], b.confirmations ?? []))
    push(
      "confirmations",
      "Confirmations",
      shortList(a.confirmations),
      shortList(b.confirmations),
    );
  if (!sameJson(a.invalidations ?? [], b.invalidations ?? []))
    push(
      "invalidations",
      "Invalidations",
      shortList(a.invalidations),
      shortList(b.invalidations),
    );
  if (!sameJson(a.risk ?? null, b.risk ?? null))
    push("risk", "Risk", a.risk ? "set" : "-", b.risk ? "set" : "-");
  if (!sameJson(a.tradeManagement ?? [], b.tradeManagement ?? []))
    push(
      "tradeManagement",
      "Trade management",
      shortList(a.tradeManagement),
      shortList(b.tradeManagement),
    );
  if (!sameJson(a.exitPlan ?? [], b.exitPlan ?? []))
    push("exitPlan", "Exit plan", shortList(a.exitPlan), shortList(b.exitPlan));
  if (checklistChanged(a.checklistItems, b.checklistItems))
    push(
      "checklist",
      "Checklist",
      checklistSummary(a.checklistItems),
      checklistSummary(b.checklistItems),
    );

  return rows;
}
