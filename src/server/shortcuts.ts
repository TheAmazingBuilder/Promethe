/**
 * Keyboard shortcuts (v2.5 Module 4 §4.1) - stored overrides over the
 * registry defaults. One row per (user, actionId); deleting all rows
 * resets everything to defaults.
 */
import { db } from "@/lib/db";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";
import type { ShortcutDTO } from "@/lib/trading/dto";

export async function listShortcuts(userId: string): Promise<ShortcutDTO[]> {
  const rows = (await db.keyboardShortcut.findMany({
    where: { userId },
  })) as unknown as Array<{ actionId: string; keys: string }>;
  const byAction = new Map(rows.map((r) => [r.actionId, r.keys]));
  return SHORTCUT_ACTIONS.filter((a) => a.editable).map((a) => ({
    actionId: a.id,
    keys: byAction.get(a.id) ?? a.defaultKeys,
    isDefault: !byAction.has(a.id),
  }));
}

export async function upsertShortcut(
  userId: string,
  actionId: string,
  keys: string
): Promise<ShortcutDTO> {
  const action = SHORTCUT_ACTIONS.find((a) => a.id === actionId && a.editable);
  if (!action) throw new Error("ACTION_NOT_EDITABLE");
  if (keys === action.defaultKeys) {
    await db.keyboardShortcut.deleteMany({ where: { userId, actionId } });
    return { actionId, keys: action.defaultKeys, isDefault: true };
  }
  await db.keyboardShortcut.upsert({
    where: { userId_actionId: { userId, actionId } },
    create: { userId, actionId, keys },
    update: { keys },
  });
  return { actionId, keys, isDefault: false };
}

export async function resetShortcuts(userId: string): Promise<void> {
  await db.keyboardShortcut.deleteMany({ where: { userId } });
}
