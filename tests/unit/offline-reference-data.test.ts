import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/offline/store";
import { setOfflineUserId } from "@/lib/offline/session";
import { fetchReferenceWithFallback } from "@/lib/offline/reference-data";

const USER_A = "reference-user-a";
const USER_B = "reference-user-b";

describe("offline reference snapshots", () => {
  it("does not cache a response after the active identity changes", async () => {
    const store = new MemoryStore();
    setOfflineUserId(USER_A);

    let resolveFetch!: (rows: Array<{ id: string }>) => void;
    const pending = fetchReferenceWithFallback(
      store,
      USER_A,
      "accounts",
      () => new Promise<Array<{ id: string }>>((resolve) => { resolveFetch = resolve; }),
    );

    setOfflineUserId(USER_B);
    resolveFetch([{ id: "account-from-a" }]);
    await pending;

    setOfflineUserId(USER_A);
    expect(await store.getReference(USER_A, "accounts")).toBeNull();
  });

  it("never falls back to another user's snapshot", async () => {
    const store = new MemoryStore();
    setOfflineUserId(USER_A);
    await store.putReference(USER_A, "accounts", [{ id: "private-account" }]);

    setOfflineUserId(USER_B);
    await expect(
      fetchReferenceWithFallback(
        store,
        USER_B,
        "accounts",
        async () => { throw new Error("offline"); },
      ),
    ).rejects.toThrow("offline");
    expect(await store.getReference(USER_B, "accounts")).toBeNull();
  });
});
