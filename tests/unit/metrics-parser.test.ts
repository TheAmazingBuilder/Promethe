/**
 * Metrics module — formula parser unit tests (v2.5 Module 1, spec §4.6).
 *
 * Tokenizer, grammar (precedence, unary chains, functions, variables),
 * null propagation, division by zero, complexity caps (tokens / nesting
 * depth) and injection resistance — the parser is hand-written, no eval.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  FormulaParseError,
  parseFormula,
  tokenizeFormula,
  validateFormula,
} from "@/lib/metrics/parser";

// ── Helpers ──────────────────────────────────────────────────────────────────

function evalWith(
  expression: string,
  variables: Record<string, number | null> = {},
): number | null {
  return evaluateFormula(parseFormula(expression), variables);
}

/** Message of the FormulaParseError thrown by parseFormula (fails if none). */
function parseErrorMessage(expression: string): string {
  try {
    parseFormula(expression);
    throw new Error(`expected parseFormula(${JSON.stringify(expression)}) to throw`);
  } catch (e) {
    if (e instanceof FormulaParseError) return e.message;
    throw e;
  }
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

describe("tokenizeFormula", () => {
  it("tokenizes numbers, names, operators, parens and commas", () => {
    expect(tokenizeFormula("min(A, 2.5)*(B+1)")).toEqual([
      { kind: "name", value: "min" },
      { kind: "lparen" },
      { kind: "name", value: "A" },
      { kind: "comma" },
      { kind: "number", value: 2.5 },
      { kind: "rparen" },
      { kind: "op", value: "*" },
      { kind: "lparen" },
      { kind: "name", value: "B" },
      { kind: "op", value: "+" },
      { kind: "number", value: 1 },
      { kind: "rparen" },
    ]);
  });

  it("skips whitespace", () => {
    expect(tokenizeFormula(" 1 +\t2\n")).toEqual([
      { kind: "number", value: 1 },
      { kind: "op", value: "+" },
      { kind: "number", value: 2 },
    ]);
  });

  it("rejects unexpected characters", () => {
    expect(() => tokenizeFormula("A;B")).toThrow(FormulaParseError);
    try {
      tokenizeFormula("A;B");
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaParseError);
      expect((e as FormulaParseError).message).toBe("unexpectedCharacter");
      expect((e as FormulaParseError).position).toBe(1); // index of ';'
    }
    expect(() => tokenizeFormula("1$2")).toThrow(FormulaParseError);
  });

  it("rejects malformed numbers", () => {
    expect(() => tokenizeFormula("1.2.3")).toThrow(FormulaParseError);
    expect(() => tokenizeFormula(".")).toThrow(FormulaParseError);
  });

  it("rejects formulas with more than 64 tokens", () => {
    expect(() => tokenizeFormula("0+".repeat(32) + "0")).toThrow(FormulaParseError); // 65 tokens
    expect(tokenizeFormula("0+".repeat(32))).toHaveLength(64); // exactly at the cap
  });
});

// ── Parsing + evaluation ─────────────────────────────────────────────────────

describe("parseFormula + evaluateFormula", () => {
  it("operator precedence and associativity", () => {
    expect(evalWith("2+3*4")).toBe(14);
    expect(evalWith("(2+3)*4")).toBe(20);
    expect(evalWith("2*3+4")).toBe(10);
    expect(evalWith("10-4-3")).toBe(3); // left-associative
  });

  it("unary operators and chains", () => {
    expect(evalWith("-3+5")).toBe(2);
    expect(evalWith("2*-3")).toBe(-6);
    expect(evalWith("--5")).toBe(5);
    expect(evalWith("+-5")).toBe(-5);
    expect(evalWith("2--3")).toBe(5);
  });

  it("functions: min / max / abs / round", () => {
    expect(evalWith("min(1,2)")).toBe(1);
    expect(evalWith("max(3,4)")).toBe(4);
    expect(evalWith("abs(0-5)")).toBe(5);
    expect(evalWith("round(2.6)")).toBe(3);
    expect(evalWith("round(2.4)")).toBe(2);
    expect(evalWith("min(max(1,2), abs(0-3))")).toBe(2); // nested calls
  });

  it("variables A / B / C", () => {
    expect(evalWith("A+B", { A: 2, B: 3 })).toBe(5);
    expect(evalWith("A*B-C", { A: 3, B: 4, C: 2 })).toBe(10);
  });

  it("missing or null variables propagate null", () => {
    expect(evalWith("A+B", { A: 2 })).toBeNull(); // B missing entirely
    expect(evalWith("A+B", { A: 2, B: null })).toBeNull(); // B null
    expect(evalWith("min(A, 1)", { A: null })).toBeNull(); // null inside calls
    expect(evalWith("-A", { A: null })).toBeNull(); // null under unary
  });

  it("non-finite variable values propagate null", () => {
    expect(evalWith("A", { A: Number.POSITIVE_INFINITY })).toBeNull();
    expect(evalWith("A", { A: Number.NaN })).toBeNull();
  });

  it("division by zero yields null", () => {
    expect(evalWith("A/0", { A: 5 })).toBeNull();
    expect(evalWith("A/B", { A: 5, B: 0 })).toBeNull();
    expect(evalWith("0/0")).toBeNull();
    expect(evalWith("A/(B-2)", { A: 5, B: 2 })).toBeNull();
    expect(evalWith("6/2")).toBe(3); // sane divisions still work
  });

  it("syntax errors", () => {
    expect(parseErrorMessage("A+")).toBe("unexpectedEnd");
    expect(parseErrorMessage(")")).toBe("unexpectedToken");
    expect(parseErrorMessage("(1+2")).toBe("unexpectedEnd"); // missing close paren
    expect(parseErrorMessage("min(1 2)")).toBe("expectedCloseParen");
    expect(parseErrorMessage("min(1,)")).toBe("unexpectedToken");
    expect(parseErrorMessage("1 2")).toBe("trailingTokens");
    expect(parseErrorMessage("")).toBe("empty");
  });

  it("unknown functions and variables", () => {
    expect(parseErrorMessage("foo(1)")).toBe("unknownFunction");
    expect(parseErrorMessage("D")).toBe("unknownVariable");
    expect(parseErrorMessage("A+D")).toBe("unknownVariable");
  });

  it("arity errors", () => {
    expect(parseErrorMessage("min(1)")).toBe("wrongArity");
    expect(parseErrorMessage("min(1,2,3)")).toBe("wrongArity");
    expect(parseErrorMessage("abs(1,2)")).toBe("wrongArity");
    expect(parseErrorMessage("round()")).toBe("wrongArity");
  });

  it("nesting deeper than the cap is rejected", () => {
    expect(parseErrorMessage("(".repeat(13) + "1" + ")".repeat(13))).toBe("tooDeep");
    expect(evalWith("(((1)))")).toBe(1); // moderate nesting parses fine
  });

  it("injection attempts are rejected, never evaluated", () => {
    // "process.exit(1)" dies in the tokenizer: the '.' is consumed as a
    // malformed number (invalidNumber) before any name lookup happens.
    for (const injection of [
      "process.exit(1)",
      "process",
      "globalThis",
      "__proto__",
      "constructor",
      "A;B",
    ]) {
      expect(() => parseFormula(injection), injection).toThrow(FormulaParseError);
      expect(validateFormula(injection).ok, injection).toBe(false);
    }
    expect(parseErrorMessage("__proto__")).toBe("unknownVariable");
    expect(parseErrorMessage("constructor")).toBe("unknownVariable");
    expect(parseErrorMessage("A;B")).toBe("unexpectedCharacter");
  });
});

// ── validateFormula ──────────────────────────────────────────────────────────

describe("validateFormula", () => {
  it("returns ok:false with an error string for bad inputs", () => {
    for (const bad of [
      "A+",
      ")",
      "foo(1)",
      "D",
      "min(1)",
      "min(1,2,3)",
      "",
      "1 2",
      "A;B",
      "(((((1))))))",
    ]) {
      const result = validateFormula(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(typeof result.error).toBe("string");
    }
  });

  it("returns ok:true with an AST for good inputs", () => {
    const result = validateFormula("A / B * 100");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.node.type).toBe("binary");
    expect(validateFormula("min(A, B)").ok).toBe(true);
    expect(validateFormula("42").ok).toBe(true);
    expect(validateFormula("-A + 2.5").ok).toBe(true);
  });
});
