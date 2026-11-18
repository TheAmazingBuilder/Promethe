/**
 * Change password — server-side (never imported by client code).
 *
 * Promethe has no forgot/reset flow and no TOTP. This is the only password
 * path: the signed-in user proves the current password, then sets a new
 * one (same strength rules as signup: 8+ chars, a letter and a digit).
 * Google-only accounts were created with a random password nobody knows,
 * so the current password check fails for them — the UI says so plainly
 * instead of pretending the form works for everyone.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "passwordRequired").max(128),
    newPassword: z
      .string()
      .min(8, "passwordMin")
      .max(128, "passwordMax")
      .regex(/[A-Za-z]/, "passwordLetter")
      .regex(/[0-9]/, "passwordDigit"),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "passwordSame",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; code: "BAD_PASSWORD" | "USER_NOT_FOUND" };

/** Verifies the current password, then stores the new hash. */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput
): Promise<ChangePasswordResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return { ok: false, code: "USER_NOT_FOUND" };
  if (!verifyPassword(input.currentPassword, user.passwordHash)) {
    return { ok: false, code: "BAD_PASSWORD" };
  }
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(input.newPassword) },
  });
  return { ok: true };
}
