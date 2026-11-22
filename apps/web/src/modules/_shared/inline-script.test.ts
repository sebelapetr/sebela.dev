import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { scriptStringLiteral } from "./inline-script";

/** Evaluates a literal as the browser evaluates the inline script's text. */
function evaluate(literal: string): unknown {
  return runInNewContext(`(${literal})`);
}

describe("scriptStringLiteral", () => {
  it("cannot end the script element or open an HTML comment, and evaluates to the value", () => {
    const value = 'x</script><script>alert(1)</script><!--y-->"\\';
    const literal = scriptStringLiteral(value);

    expect(literal).not.toContain("<");
    expect(literal).not.toContain(">");
    expect(literal).not.toMatch(/<\/script/i);
    expect(evaluate(literal)).toBe(value);
  });

  it("escapes the line and paragraph separators, which end a line in older script engines", () => {
    const value = "a\u2028b\u2029c";
    const literal = scriptStringLiteral(value);

    expect(literal).not.toContain("\u2028");
    expect(literal).not.toContain("\u2029");
    expect(evaluate(literal)).toBe(value);
  });

  it("leaves a value without those characters exactly as JSON writes it", () => {
    expect(scriptStringLiteral("sebela-theme")).toBe('"sebela-theme"');
    expect(scriptStringLiteral("data-theme")).toBe('"data-theme"');
  });
});
