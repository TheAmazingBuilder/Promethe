/**
 * Gaïa version comparison (Lot 11, roadmap §15).
 *
 * The version history dialog used to offer only a blind "Restore": the
 * user could not see what a version contained before replacing the
 * current note. This module diffs the plain-text lines of two versions
 * so the dialog can preview a version and show what restoring it would
 * change.
 *
 * The diff is intentionally simple (line multiset, order-insensitive for
 * membership, order-sensitive display): added lines are lines present in
 * the version but not in the current note, removed lines the reverse.
 * A line that only moved keeps the note identical and is not reported.
 * Duplicate identical lines are counted with multiplicity.
 */

export interface GaiaTextDiff {
  added: string[];
  removed: string[];
  /** Lines present in both (by content, counting multiplicity). */
  unchanged: number;
}

export function diffGaiaText(currentText: string, versionText: string): GaiaTextDiff {
  const split = (text: string): string[] =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  const currentLines = split(currentText);
  const versionLines = split(versionText);

  const currentCounts = new Map<string, number>();
  for (const line of currentLines) {
    currentCounts.set(line, (currentCounts.get(line) ?? 0) + 1);
  }
  const versionCounts = new Map<string, number>();
  for (const line of versionLines) {
    versionCounts.set(line, (versionCounts.get(line) ?? 0) + 1);
  }

  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  const seen = new Set<string>([...currentCounts.keys(), ...versionCounts.keys()]);
  for (const line of seen) {
    const inCurrent = currentCounts.get(line) ?? 0;
    const inVersion = versionCounts.get(line) ?? 0;
    const shared = Math.min(inCurrent, inVersion);
    unchanged += shared;
    for (let i = 0; i < inVersion - shared; i += 1) added.push(line);
    for (let i = 0; i < inCurrent - shared; i += 1) removed.push(line);
  }
  return { added, removed, unchanged };
}
