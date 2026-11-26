import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  sessionDeleteMany: vi.fn(),
  transaction: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));

import { hashSessionToken } from "@/lib/auth/session-token";
import { changePassword } from "@/server/change-password";

describe("changePassword session revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: "stored-hash",
    });
    mocks.verifyPassword.mockReturnValue(true);
    mocks.hashPassword.mockReturnValue("new-hash");
    mocks.userUpdate.mockResolvedValue({});
    mocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        user: { update: mocks.userUpdate },
        authSession: { deleteMany: mocks.sessionDeleteMany },
      })
    );
  });

  it("updates the password and revokes every session except the current one atomically", async () => {
    const currentToken = "current-session-token";
    const result = await changePassword(
      "user-1",
      { currentPassword: "OldPass123", newPassword: "NewPass456" },
      currentToken
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash" },
    });
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: { not: hashSessionToken(currentToken) },
      },
    });
  });

  it("does not update the password or revoke sessions when the current password is wrong", async () => {
    mocks.verifyPassword.mockReturnValue(false);

    const result = await changePassword(
      "user-1",
      { currentPassword: "WrongPass123", newPassword: "NewPass456" },
      "current-session-token"
    );

    expect(result).toEqual({ ok: false, code: "BAD_PASSWORD" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();
  });
});
