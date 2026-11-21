import { runInNewContext } from "node:vm";

import fc from "fast-check";
import { describe, it } from "vitest";

import { scriptStringLiteral } from "./inline-script";

/** Fixed, so a run is as long on every machine; a failure prints the seed that reproduces it. */
const numRuns = 500;

/**
 * Any UTF-16 code unit (lone surrogates too), mixed with the characters that matter to an HTML
 * parser or a script engine, so `</script>`, `<!--` and the separators are drawn often.
 */
const character = fc.oneof(
  fc.integer({ min: 0, max: 0xffff }).map((unit) => String.fromCharCode(unit)),
  fc.constantFrom("<", ">", "/", "!", "-", "\\", '"', "'", "\u2028", "\u2029", "script", "\n"),
);
const anyValue = fc.string({ unit: character, maxLength: 40 });

describe("scriptStringLiteral (properties)", () => {
  it("for any value, the literal holds no raw <, >, /, line or paragraph separator", () => {
    fc.assert(
      fc.property(anyValue, (value) => !/[<>/\u2028\u2029]/.test(scriptStringLiteral(value))),
      { numRuns },
    );
  });

  it("for any value, the literal evaluates back to exactly that value", () => {
    fc.assert(
      fc.property(
        anyValue,
        (value) => runInNewContext(`(${scriptStringLiteral(value)})`) === value,
      ),
      { numRuns },
    );
  });
});
