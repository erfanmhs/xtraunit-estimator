/**
 * The price-cell formula evaluator. Every cost cell on the Pricing page runs
 * through this, so a wrong answer is a wrong bid — and it must NEVER throw or
 * execute anything, since it takes raw typed input.
 */
import { describe, expect, it } from "vitest";
import { evalFormula } from "./formula";

describe("evalFormula", () => {
  it("reads a plain number", () => {
    expect(evalFormula("42")).toBe(42);
    expect(evalFormula("3.5")).toBe(3.5);
    expect(evalFormula(".5")).toBe(0.5);
  });

  it("does the four operations", () => {
    expect(evalFormula("2+3")).toBe(5);
    expect(evalFormula("10-4")).toBe(6);
    expect(evalFormula("6*7")).toBe(42);
    expect(evalFormula("9/3")).toBe(3);
  });

  it("respects precedence and parentheses", () => {
    expect(evalFormula("2+3*4")).toBe(14);
    expect(evalFormula("(2+3)*4")).toBe(20);
    expect(evalFormula("(100+50)/2")).toBe(75);
  });

  it("accepts the ways an estimator actually types", () => {
    expect(evalFormula("=2*3")).toBe(6); // leading equals
    expect(evalFormula("$1,250")).toBe(1250); // dollars and thousands
    expect(evalFormula(" 2 * 1.1 ")).toBeCloseTo(2.2, 10); // spaces
    expect(evalFormula("2.5x1.1")).toBeCloseTo(2.75, 10); // x for multiply
    expect(evalFormula("2.5X4")).toBe(10);
    expect(evalFormula("10÷4")).toBe(2.5);
  });

  it("handles unary signs", () => {
    expect(evalFormula("-5")).toBe(-5);
    expect(evalFormula("+5")).toBe(5);
    expect(evalFormula("10*-2")).toBe(-20);
  });

  it("returns null for anything it can't read, instead of throwing", () => {
    for (const bad of ["", "   ", "abc", "2+", "(2+3", "2+3)", "1/0", "--", "2**3"]) {
      expect(evalFormula(bad)).toBeNull();
    }
  });

  it("never evaluates code", () => {
    // If this ever returned a number, the cell would be a script injection.
    expect(evalFormula("process.exit(1)")).toBeNull();
    expect(evalFormula("1;alert(1)")).toBeNull();
    expect(evalFormula("[].constructor")).toBeNull();
  });

  it("rejects a result that isn't a real number", () => {
    expect(evalFormula("1/0")).toBeNull(); // Infinity is not a price
  });
});
