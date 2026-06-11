/**
 * Tiny Excel-style formula evaluator for price cells.
 * Supports numbers, + - * /, parentheses, unary minus, an optional leading "=",
 * "x" as multiply, and ignores $ , and spaces. Returns null if it can't parse —
 * never throws, never executes code.
 */
export function evalFormula(input: string): number | null {
  const s = input
    .trim()
    .replace(/^=/, "")
    .replace(/[$,\s]/g, "")
    .replace(/[xX×]/g, "*")
    .replace(/÷/g, "/");
  if (!s) return null;

  let i = 0;

  function parseExpr(): number {
    let v = parseTerm();
    while (i < s.length && (s[i] === "+" || s[i] === "-")) {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function parseTerm(): number {
    let v = parseFactor();
    while (i < s.length && (s[i] === "*" || s[i] === "/")) {
      const op = s[i++];
      const r = parseFactor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function parseFactor(): number {
    if (s[i] === "(") {
      i++;
      const v = parseExpr();
      if (s[i] !== ")") throw new Error("unbalanced");
      i++;
      return v;
    }
    if (s[i] === "-") {
      i++;
      return -parseFactor();
    }
    if (s[i] === "+") {
      i++;
      return parseFactor();
    }
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) throw new Error("number expected");
    i += m[0].length;
    return Number(m[0]);
  }

  try {
    const v = parseExpr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}
