/**
 * Playbook checklist evaluation (Lot 11, roadmap §14).
 *
 * A trade stores the user's checklist answers (`checklistResults`, a
 * `{ [itemId]: boolean }` map) but nothing ever evaluated them: a required
 * item left unchecked was invisible to every evaluation in the app. This
 * module is the single place that turns answers into a verdict.
 *
 * Semantics (deliberate):
 * - Only items marked `isRequired` count. Optional items are never a
 *   failure, however they were answered.
 * - A required item with no answer is treated as UNCHECKED, never as
 *   "not applicable". Silence is not compliance.
 * - Answers for items that no longer exist on the strategy are ignored.
 * - An empty required list means the checklist is trivially complete
 *   (there is nothing to enforce), not "missing".
 */

export interface ChecklistEvalItem {
  id: string;
  label: string;
  isRequired: boolean;
}

export interface ChecklistStatus {
  /** Required items on the checklist used for this evaluation. */
  requiredTotal: number;
  /** Required items answered true. */
  requiredChecked: number;
  /** Labels of the required items left unchecked (or unanswered). */
  missing: string[];
  /** True when every required item was checked. */
  complete: boolean;
}

export function evaluateChecklist(
  items: ChecklistEvalItem[],
  results: Record<string, boolean> | null | undefined,
): ChecklistStatus {
  const required = items.filter((item) => item.isRequired);
  const missing = required
    .filter((item) => results?.[item.id] !== true)
    .map((item) => item.label);
  return {
    requiredTotal: required.length,
    requiredChecked: required.length - missing.length,
    missing,
    complete: missing.length === 0,
  };
}

/** One frozen checklist item, as stored in a strategy snapshot. */
export interface FrozenChecklistItem {
  /** Present on snapshots taken after Lot 11; older ones carry labels only. */
  id?: string;
  label: string;
  isRequired: boolean;
}

/**
 * Resolves frozen checklist items to the answer keys of a trade's
 * `checklistResults` map. A frozen item answers under its own id when
 * the trade recorded one; otherwise under the live item with the same
 * label (covers snapshots taken before ids were stored, and items whose
 * id changed). No match at all means the item is treated as unanswered.
 */
export function resolveFrozenChecklistItems(
  frozen: FrozenChecklistItem[],
  live: Array<{ id: string; label: string }>,
): ChecklistEvalItem[] {
  return frozen.map((item) => {
    let key = item.id ?? null;
    if (key == null) {
      key = live.find((liveItem) => liveItem.label === item.label)?.id ?? null;
    }
    return {
      id: key ?? `frozen:${item.label}`,
      label: item.label,
      isRequired: item.isRequired,
    };
  });
}
