// @vitest-environment jsdom
/**
 * v2.5 Module 8 — DOM leak tests (§3.1).
 *
 * Renders the privacy components in HIDE mode and asserts that NO currency
 * pattern from the fixture data appears anywhere in the rendered DOM —
 * text nodes, attributes, title/aria labels included. Complements the
 * formatter tests (choke point) and the browser-level verification.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Money, Sensitive } from "@/components/privacy/money";
import { I18nProvider } from "@/i18n/i18n-provider";
import { setPrivacy, loadPrivacyState } from "@/lib/privacy/store";
import { DEFAULT_PRIVACY_PREFERENCES } from "@/lib/privacy/types";
import { fmtMoney, fmtSignedMoney, fmtPct } from "@/lib/format";

afterEach(() => {
  cleanup();
  loadPrivacyState(DEFAULT_PRIVACY_PREFERENCES, { adopt: false });
});

/** Fixture amounts — if any of these appear in the DOM, HIDE mode leaks. */
const FIXTURE_AMOUNTS = [
  "1234.56",
  "1 234,56",
  "1\u202f234,56",
  "1,234.56",
  "USD",
  "987,65",
  "987.65",
  "42 000",
  "42,000",
  "42000",
  "EUR",
];

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

function assertNoAmounts(container: HTMLElement) {
  const html = container.innerHTML;
  const text = container.textContent ?? "";
  const allAttributes = Array.from(container.querySelectorAll("*"))
    .flatMap((el) => Array.from(el.attributes).map((a) => `${a.name}=${a.value}`))
    .join("\n");
  for (const amount of FIXTURE_AMOUNTS) {
    expect(text, `DOM text leaks "${amount}"`).not.toContain(amount);
    expect(html, `DOM html leaks "${amount}"`).not.toContain(amount);
    expect(allAttributes, `DOM attributes leak "${amount}"`).not.toContain(amount);
  }
}

describe("<Money/> in HIDE mode", () => {
  it("renders the placeholder, never the real value, and announces 'amount hidden'", () => {
    setPrivacy({ mode: "HIDE" });
    const { container, getAllByText } = renderWithI18n(
      <>
        <Money value="1234.56" currency="USD" />
        <Money value="-987.65" currency="USD" signed />
        <Money value={42000} currency="EUR" kind="balance" />
      </>
    );
    expect(getAllByText("••••").length).toBeGreaterThanOrEqual(3);
    // Screen-reader text announces the hidden state.
    expect(getAllByText("Amount hidden").length).toBeGreaterThanOrEqual(3);
    assertNoAmounts(container);
  });

  it("keeps R multiples, pips and win rates visible by default (§3.1)", () => {
    setPrivacy({ mode: "HIDE" });
    // R / pips / win rates go through fmtNum/fmtSigned — not masked.
    expect(fmtPct(58.3)).toMatch(/58[.,]3 %/);
    const { container } = renderWithI18n(
      <Money value="1234.56" currency="USD" />
    );
    expect(container.textContent).toContain("••••");
  });

  it("masks percentages too when hidePercentages is on", () => {
    setPrivacy({ mode: "HIDE", scope: { hidePercentages: true } });
    expect(fmtPct(58.3)).toBe("••••");
  });

  it("renders real values in OFF mode (no regression)", () => {
    setPrivacy({ mode: "OFF" });
    const { container } = renderWithI18n(
      <Money value="987.65" currency="USD" />
    );
    expect(container.textContent).toMatch(/987[.,]65/);
    expect(container.textContent).toContain("USD");
  });
});

describe("<Sensitive/> in HIDE mode", () => {
  it("never renders the wrapped children (lots, account, broker)", () => {
    // lots/account/broker are opt-in scope flags (default false, §3.1).
    setPrivacy({
      mode: "HIDE",
      scope: { hideLots: true, hideAccountNames: true, hideBrokerInfo: true },
    });
    const { container } = renderWithI18n(
      <>
        <Sensitive kind="lots">1.75</Sensitive>
        <Sensitive kind="account">FTMO-100K-A3B4</Sensitive>
        <Sensitive kind="broker">ICMarkets-Live07</Sensitive>
      </>
    );
    const html = container.innerHTML;
    expect(container.textContent).toContain("••••");
    expect(html).not.toContain("1.75");
    expect(html).not.toContain("FTMO");
    expect(html).not.toContain("ICMarkets");
    expect(container.textContent).toContain("hidden");
  });

  it("renders children in OFF mode, blurs in BLUR mode (real text present)", () => {
    setPrivacy({ mode: "OFF" });
    const off = renderWithI18n(
      <Sensitive kind="account">FTMO-100K</Sensitive>
    );
    expect(off.container.textContent).toContain("FTMO-100K");
    cleanup();

    setPrivacy({ mode: "BLUR", scope: { hideAccountNames: true } });
    const blur = renderWithI18n(
      <Sensitive kind="account">FTMO-100K</Sensitive>
    );
    // BLUR keeps the real text in the DOM (documented limit) + blur class.
    expect(blur.container.textContent).toContain("FTMO-100K");
    expect(blur.container.querySelector(".sensitive")).not.toBeNull();
  });

  it("leaves opt-out kinds visible in HIDE mode (default scope)", () => {
    setPrivacy({ mode: "HIDE" });
    const { container } = renderWithI18n(
      <Sensitive kind="account">FTMO-100K</Sensitive>
    );
    expect(container.textContent).toContain("FTMO-100K");
    expect(container.querySelector(".sensitive")).toBeNull();
  });
});

describe("choke point formatters in HIDE mode", () => {
  it("no fixture currency pattern appears in formatted output", () => {
    setPrivacy({ mode: "HIDE" });
    const outputs = [
      fmtMoney("1234.56", "USD"),
      fmtSignedMoney("-987.65", "USD"),
      fmtMoney(42000, "EUR"),
      fmtMoney("0.01", "USD"),
    ];
    for (const out of outputs) {
      expect(out).toBe("••••");
    }
  });

  it("scope flags selectively disable masking", () => {
    setPrivacy({ mode: "HIDE", scope: { hideCurrencyAmounts: false } });
    expect(fmtMoney("987.65", "USD")).toMatch(/987[.,]65/);
    setPrivacy({ mode: "HIDE", scope: { hideCurrencyAmounts: true, hideLots: false } });
    expect(fmtMoney("987.65", "USD")).toBe("••••");
  });
});
