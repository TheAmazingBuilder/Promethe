/**
 * Metrics module — hand-written formula parser (v2.5 Module 1, spec §4.6).
 *
 * Grammar (recursive descent, NO eval / new Function — safe by construction):
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor)*
 *   factor  := ('+' | '-') factor | primary
 *   primary := NUMBER | NAME ('(' args ')')? | '(' expr ')'
 *   args    := expr (',' expr)*
 *
 * Names: A, B, C (sub-metrics) — functions: min, max, abs, round.
 * Complexity caps: ≤ 64 tokens, nesting depth ≤ 12, ≤ 2 args per call.
 */

export type FormulaToken =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

export class FormulaParseError extends Error {
  constructor(
    message: string,
    public readonly position: number
  ) {
    super(message);
    this.name = "FormulaParseError";
  }
}

const MAX_TOKENS = 64;
const MAX_DEPTH = 12;

/** Tokenize - throws FormulaParseError on unexpected characters. */
export function tokenizeFormula(input: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      let dots = 0;
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        if (input[i] === ".") dots++;
        num += input[i];
        i++;
      }
      if (dots > 1 || num === "." || num === "") {
        throw new FormulaParseError("invalidNumber", i);
      }
      tokens.push({ kind: "number", value: Number(num) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let name = "";
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) {
        name += input[i];
        i++;
      }
      tokens.push({ kind: "name", value: name });
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    throw new FormulaParseError("unexpectedCharacter", i);
  }
  if (tokens.length > MAX_TOKENS) {
    throw new FormulaParseError("tooManyTokens", input.length);
  }
  return tokens;
}

// ── AST ──────────────────────────────────────────────────────────────────────

export type FormulaNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | {
      type: "unary";
      op: "-" | "+";
      operand: FormulaNode;
    }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  | { type: "call"; fn: FormulaFunctionName; args: FormulaNode[] };

export type FormulaFunctionName = "min" | "max" | "abs" | "round";

const FUNCTIONS: readonly FormulaFunctionName[] = ["min", "max", "abs", "round"];
const ALLOWED_VARIABLES = new Set(["A", "B", "C"]);

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: FormulaToken[]) {}

  private peek(): FormulaToken | undefined {
    return this.tokens[this.pos];
  }

  private next(): FormulaToken {
    const token = this.tokens[this.pos];
    if (!token) throw new FormulaParseError("unexpectedEnd", this.pos);
    this.pos++;
    return token;
  }

  parse(): FormulaNode {
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new FormulaParseError("trailingTokens", this.pos);
    }
    return node;
  }

  private enter(): void {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      throw new FormulaParseError("tooDeep", this.pos);
    }
  }

  private leave(): void {
    this.depth--;
  }

  private parseExpr(): FormulaNode {
    this.enter();
    try {
      let left = this.parseTerm();
      for (;;) {
        const token = this.peek();
        if (token?.kind === "op" && (token.value === "+" || token.value === "-")) {
          this.next();
          const right = this.parseTerm();
          left = { type: "binary", op: token.value, left, right };
        } else {
          return left;
        }
      }
    } finally {
      this.leave();
    }
  }

  private parseTerm(): FormulaNode {
    this.enter();
    try {
      let left = this.parseFactor();
      for (;;) {
        const token = this.peek();
        if (token?.kind === "op" && (token.value === "*" || token.value === "/")) {
          this.next();
          const right = this.parseFactor();
          left = { type: "binary", op: token.value, left, right };
        } else {
          return left;
        }
      }
    } finally {
      this.leave();
    }
  }

  private parseFactor(): FormulaNode {
    const token = this.peek();
    if (token?.kind === "op" && (token.value === "-" || token.value === "+")) {
      this.next();
      return { type: "unary", op: token.value, operand: this.parseFactor() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    this.enter();
    try {
      const token = this.next();
      if (token.kind === "number") {
        return { type: "number", value: token.value };
      }
      if (token.kind === "name") {
        const name = token.value;
        // Function call?
        if (this.peek()?.kind === "lparen") {
          if (!(FUNCTIONS as readonly string[]).includes(name)) {
            throw new FormulaParseError("unknownFunction", this.pos);
          }
          this.next(); // consume (
          const args: FormulaNode[] = [];
          if (this.peek()?.kind !== "rparen") {
            args.push(this.parseExpr());
            while (this.peek()?.kind === "comma") {
              this.next();
              args.push(this.parseExpr());
            }
          }
          const close = this.next();
          if (close.kind !== "rparen") {
            throw new FormulaParseError("expectedCloseParen", this.pos);
          }
          const fn = name as FormulaFunctionName;
          const arity = fn === "abs" || fn === "round" ? 1 : 2;
          if (args.length !== arity) {
            throw new FormulaParseError("wrongArity", this.pos);
          }
          return { type: "call", fn, args };
        }
        if (!ALLOWED_VARIABLES.has(name)) {
          throw new FormulaParseError("unknownVariable", this.pos);
        }
        return { type: "variable", name };
      }
      if (token.kind === "lparen") {
        const inner = this.parseExpr();
        const close = this.next();
        if (close.kind !== "rparen") {
          throw new FormulaParseError("expectedCloseParen", this.pos);
        }
        return inner;
      }
      throw new FormulaParseError("unexpectedToken", this.pos);
    } finally {
      this.leave();
    }
  }
}

/** Parse a formula expression into an AST (throws FormulaParseError). */
export function parseFormula(expression: string): FormulaNode {
  const tokens = tokenizeFormula(expression);
  if (tokens.length === 0) throw new FormulaParseError("empty", 0);
  return new Parser(tokens).parse();
}

/** Static validation helper for the builder UI. */
export function validateFormula(
  expression: string
): { ok: true; node: FormulaNode } | { ok: false; error: string } {
  try {
    const node = parseFormula(expression);
    return { ok: true, node };
  } catch (e) {
    if (e instanceof FormulaParseError) return { ok: false, error: e.message };
    return { ok: false, error: "invalid" };
  }
}

/**
 * Evaluate an AST against sub-metric values. Division by zero → null
 * (callers render "n/a"); unknown variables → null.
 */
export function evaluateFormula(
  node: FormulaNode,
  variables: Record<string, number | null>
): number | null {
  switch (node.type) {
    case "number":
      return node.value;
    case "variable": {
      const value = variables[node.name];
      return value == null || !Number.isFinite(value) ? null : value;
    }
    case "unary": {
      const v = evaluateFormula(node.operand, variables);
      if (v == null) return null;
      return node.op === "-" ? -v : v;
    }
    case "binary": {
      const left = evaluateFormula(node.left, variables);
      const right = evaluateFormula(node.right, variables);
      if (left == null || right == null) return null;
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right === 0 ? null : left / right;
      }
    }
    case "call": {
      const args = node.args.map((a) => evaluateFormula(a, variables));
      if (args.some((a) => a == null)) return null;
      const [a, b] = args as number[];
      switch (node.fn) {
        case "min":
          return Math.min(a, b!);
        case "max":
          return Math.max(a, b!);
        case "abs":
          return Math.abs(a);
        case "round":
          return Math.round(a);
      }
    }
  }
}
