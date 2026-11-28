import { describe, expect, it, vi } from "vitest";
import {
  getOfflineUserId,
  onOfflineUserIdChange,
  setOfflineUserId,
} from "@/lib/offline/session";

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  private listeners = new Set<(event: MessageEvent) => void>();
  readonly sent: unknown[] = [];

  constructor(_name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.add(listener);
  }

  postMessage(value: unknown) {
    this.sent.push(value);
  }

  dispatch(value: unknown) {
    const event = { data: value } as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

describe("offline session broadcasts", () => {
  it("distinguishes local identity changes from remote tab changes", () => {
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

    const changes: Array<[string | null, boolean]> = [];
    const unsubscribe = onOfflineUserIdChange((userId, isRemote) => {
      changes.push([userId, isRemote]);
    });

    try {
      setOfflineUserId("tab-a-user");
      const channel = FakeBroadcastChannel.instances[0];
      expect(channel).toBeDefined();
      channel.dispatch({ userId: "tab-b-user" });
      // A duplicate remote broadcast still forces React session revalidation.
      channel.dispatch({ userId: "tab-b-user" });

      expect(getOfflineUserId()).toBe("tab-b-user");
      expect(changes).toEqual([
        ["tab-a-user", false],
        ["tab-b-user", true],
        ["tab-b-user", true],
      ]);
    } finally {
      unsubscribe();
      setOfflineUserId(null);
      vi.unstubAllGlobals();
    }
  });



    try {
      setOfflineUserId("same-user");
      FakeBroadcastChannel.instances[0].dispatch({ userId: "same-user" });
      expect(changes).toEqual([false, true]);
    } finally {
      unsubscribe();
      setOfflineUserId(null);
      vi.unstubAllGlobals();
    }
  });
});
