import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const calculator = readFileSync(
  new URL("../../src/components/tools/risk-reward-calculator.tsx", import.meta.url),
  "utf8"
);
const messages = readFileSync(
  new URL("../../messages/en.json", import.meta.url),
  "utf8"
);

describe("Risk / Reward copy consistency", () => {
  it("uses the app's standard hyphen instead of an em dash", () => {
    expect(calculator).not.toContain("—");
  });

  it("uses clear, trader-friendly explanations", () => {
    expect(messages).toContain("Compare win rates and reward-to-risk ratios.");
    expect(messages).toContain("Break-even win rate at {rr}:1");
    expect(messages).toContain("This is only a projection, not a promise.");
    expect(messages).not.toContain("the less risk you need to take");
  });
});
