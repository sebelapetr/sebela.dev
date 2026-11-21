import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LlmsTxtLink } from "./llms-txt-link";

describe("LlmsTxtLink", () => {
  it("points language models at llms.txt as the page's plain-text alternate", () => {
    expect(renderToStaticMarkup(createElement(LlmsTxtLink))).toBe(
      '<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt"/>',
    );
  });
});
