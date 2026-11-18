import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { colorTokens } from "@sebela/ui/lib/tokens";

// The colour tokens are written twice: as CSS custom properties for the pages and as values for
// images rendered outside CSS (the Open Graph previews). This keeps the two from drifting apart.
const css = readFileSync(createRequire(import.meta.url).resolve("@sebela/ui/globals.css"), "utf8");

/** The custom properties of the first rule whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule for ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

describe("colorTokens", () => {
  it.each([
    ["light", ":root"],
    ["dark", ':root[data-theme="dark"]'],
  ] as const)("matches the %s theme's custom properties", (theme, selector) => {
    const properties = block(selector);
    const tokens = Object.entries(colorTokens[theme]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const [name, value] of tokens) {
      expect({ name, value }).toEqual({ name, value: properties.get(kebab(name)) });
    }
  });
});
