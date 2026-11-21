/**
 * v2.5 Module 8 — privacy store & policy unit tests (node environment: no
 * window, so localStorage persistence is skipped and the store stays
 * in-memory — exactly what the formatters rely on server-side / in tests).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setPrivacy,
  getPrivacySnapshot,
  loadPrivacyState,
  subscribePrivacy,
  engageAutoPrivacy,
  releaseAutoPrivacy,
  isAutoPrivacyActive,
} from "@/lib/privacy/store";
import { DEFAULT_PRIVACY_PREFERENCES } from "@/lib/privacy/types";
import {
  PRIVACY_PLACEHOLDER,
  isSensitiveKindBlurred,
  isSensitiveKindHidden,
  privacyMask,
  redactAmountsInText,
} from "@/lib/privacy/policy";
import { fmtMoney, fmtPct, fmtSignedMoney } from "@/lib/format";

afterEach(() => {
  loadPrivacyState(DEFAULT_PRIVACY_PREFERENCES, { adopt: false });
});

describe("privacy store", () => {
  it("defaults to OFF with the default scope", () => {
    const s = getPrivacySnapshot();
    expect(s.mode).toBe("OFF");
    expect(s.scope.hideCurrencyAmounts).toBe(true);
    expect(s.scope.hidePercentages).toBe(false);
  });

  it("setPrivacy patches and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrivacy(listener);
    setPrivacy({ mode: "HIDE" });
    expect(listener).toHaveBeenCalled();
    expect(getPrivacySnapshot().mode).toBe("HIDE");

    setPrivacy({ scope: { hideLots: true } });
    expect(getPrivacySnapshot().scope.hideLots).toBe(true);
    // Unrelated patch does not corrupt other slices.
    expect(getPrivacySnapshot().scope.hideCurrencyAmounts).toBe(true);
    unsubscribe();

    listener.mockClear();
    setPrivacy({ mode: "HIDE" }); // no-op patch — same value
    expect(listener).not.toHaveBeenCalled();
  });

  it("loadPrivacyState normalizes invalid values", () => {
    loadPrivacyState(
      {
        mode: "WAT",
        scope: { hidePercentages: true },
        auto: { onInactivitySeconds: 99999 },
        shortcut: "",
      },
      { adopt: false }
    );
    const s = getPrivacySnapshot();
    expect(s.mode).toBe("OFF");
    expect(s.scope.hidePercentages).toBe(true);
    expect(s.shortcut).toBe(DEFAULT_PRIVACY_PREFERENCES.shortcut);
  });
});

describe("auto-privacy triggers (window blur / inactivity)", () => {
  it("engageAutoPrivacy forces HIDE without touching the user's mode", () => {
    setPrivacy({ mode: "OFF" });
    engageAutoPrivacy();
    expect(getPrivacySnapshot().mode).toBe("HIDE");
    expect(isAutoPrivacyActive()).toBe(true);
    // The user's chosen mode is still OFF — release restores it.
    releaseAutoPrivacy();
    expect(getPrivacySnapshot().mode).toBe("OFF");
    expect(isAutoPrivacyActive()).toBe(false);
  });

  it("engage keeps the user's active mode (HIDE/BLUR) untouched", () => {
    setPrivacy({ mode: "BLUR" });
    engageAutoPrivacy();
    expect(getPrivacySnapshot().mode).toBe("BLUR");
    releaseAutoPrivacy();
    expect(getPrivacySnapshot().mode).toBe("BLUR");
  });

  it("a manual mode change while overridden wins going forward", () => {
    setPrivacy({ mode: "OFF" });
    engageAutoPrivacy();
    expect(getPrivacySnapshot().mode).toBe("HIDE");
    // User explicitly picks HIDE while the auto-trigger is engaged.
    setPrivacy({ mode: "HIDE" });
    releaseAutoPrivacy();
    expect(getPrivacySnapshot().mode).toBe("HIDE");
  });
});

describe("privacy policy", () => {
  it("isSensitiveKindHidden respects mode + scope", () => {
    const base = getPrivacySnapshot();
    expect(isSensitiveKindHidden(base, "amount")).toBe(false);
    setPrivacy({ mode: "HIDE" });
    expect(isSensitiveKindHidden(getPrivacySnapshot(), "amount")).toBe(true);
    expect(isSensitiveKindHidden(getPrivacySnapshot(), "percent")).toBe(false);
    setPrivacy({ mode: "BLUR" });
    expect(isSensitiveKindBlurred(getPrivacySnapshot(), "amount")).toBe(true);
    expect(isSensitiveKindHidden(getPrivacySnapshot(), "amount")).toBe(true);
  });

  it("privacyMask returns the placeholder only in HIDE mode", () => {
    const real = "987.65 USD";
    setPrivacy({ mode: "BLUR" });
    expect(privacyMask(getPrivacySnapshot(), "amount", real)).toBe(real);
    setPrivacy({ mode: "HIDE" });
    expect(privacyMask(getPrivacySnapshot(), "amount", real)).toBe(PRIVACY_PLACEHOLDER);
    setPrivacy({ mode: "OFF" });
    expect(privacyMask(getPrivacySnapshot(), "amount", real)).toBe(real);
  });

  it("redactAmountsInText masks currency amounts, keeps counts", () => {
    const body = "Trade closed: +1 234,56 USD (2 trades, R +1.8, 3 rules)";
    const redacted = redactAmountsInText(body);
    expect(redacted).not.toContain("1 234");
    expect(redacted).not.toContain("USD");
    expect(redacted).toContain("2 trades");
    expect(redacted).toContain("R +1.8");
    expect(redacted).toContain("3 rules");
  });
});

describe("privacy-aware formatters (choke point)", () => {
  it("fmtMoney returns the placeholder in HIDE mode", () => {
    setPrivacy({ mode: "OFF" });
    expect(fmtMoney("987.65", "USD")).toBe("987.65 USD");
    setPrivacy({ mode: "HIDE" });
    expect(fmtMoney("1234.56", "USD")).toBe(PRIVACY_PLACEHOLDER);
    setPrivacy({ mode: "OFF" });
    expect(fmtMoney("987.65", "USD")).toBe("987.65 USD");
  });

  it("fmtSignedMoney masks the sign too", () => {
    setPrivacy({ mode: "HIDE" });
    expect(fmtSignedMoney("-450.25", "EUR")).toBe(PRIVACY_PLACEHOLDER);
    expect(fmtSignedMoney("+450.25", "EUR")).toBe(PRIVACY_PLACEHOLDER);
  });

  it("fmtPct respects hidePercentages (default false)", () => {
    setPrivacy({ mode: "HIDE" });
    expect(fmtPct(58.3)).toBe("58.3 %");
    setPrivacy({ mode: "HIDE", scope: { hidePercentages: true } });
    expect(fmtPct(58.3)).toBe(PRIVACY_PLACEHOLDER);
  });

  it("non-amount formats are untouched in HIDE mode", () => {
    setPrivacy({ mode: "HIDE" });
    // R multiples and pips stay visible by default (§3.1 contract).
    expect(fmtSignedMoney("1234.56", "USD")).toBe(PRIVACY_PLACEHOLDER);
    setPrivacy({ scope: { hideRAndPips: false } });
    expect(fmtPct(50)).toBe("50 %");
  });
});
