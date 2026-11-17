/**
 * Gaïa : versioning des notes (snapshots avant modification).
 *
 * Règles (spec backend §5) :
 * - snapshot AVANT toute modification porteuse de contenu, jamais à la
 *   création, jamais sur un simple touchViewed, jamais sur
 *   trash / restore / purge / duplicate ;
 * - savedAt = updatedAt de la note AVANT la modification ;
 * - throttle 3 minutes, double garde : même minute calendaire ET moins de
 *   3 minutes écoulées depuis le snapshot le plus récent ;
 * - cap 12 : au-delà des 12 versions les plus récentes, les plus anciennes
 *   sont supprimées physiquement.
 */

export const VERSION_MIN_INTERVAL_MS = 3 * 60_000;
export const VERSION_CAP = 12;

/**
 * Double garde du throttle : pas de snapshot si le plus récent date de la
 * même minute calendaire (YYYY-MM-DDTHH:mm) ou de moins de 3 minutes.
 */
export function shouldSnapshot(
  newestSavedAt: Date | null,
  now: Date,
): boolean {
  if (newestSavedAt === null) return true;
  if (now.toISOString().slice(0, 16) === newestSavedAt.toISOString().slice(0, 16)) {
    return false;
  }
  return now.getTime() - newestSavedAt.getTime() >= VERSION_MIN_INTERVAL_MS;
}

/** Nombre de versions à conserver, les plus récentes d'abord (cap 12). */
export function applyRetention(newestFirstCount: number): number {
  return Math.min(newestFirstCount, VERSION_CAP);
}

/**
 * Trie des versions du plus récent au plus ancien (savedAt desc, puis
 * createdAt desc en cas d'égalité).
 */
export function sortVersionsNewestFirst<T extends { savedAt: Date; createdAt: Date }>(
  versions: T[],
): T[] {
  return [...versions].sort(
    (a, b) =>
      b.savedAt.getTime() - a.savedAt.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

/** Ids des versions à supprimer pour respecter le cap (les plus anciennes). */
export function versionsBeyondCap<T extends { id: string; savedAt: Date; createdAt: Date }>(
  versionsNewestFirst: T[],
): string[] {
  return versionsNewestFirst.slice(VERSION_CAP).map((v) => v.id);
}
