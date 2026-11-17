import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProseMarkdown } from "./markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(ProseMarkdown, { children: markdown }));
}

describe("ProseMarkdown", () => {
  it("renders paragraphs, emphasis, lists, code and web links", () => {
    const html = render(
      "Built **a planner** in `TypeScript`.\n\n- one\n- two\n\n[Notes](https://notes.example.test/)",
    );

    expect(html).toContain("<strong");
    expect(html).toContain("<code");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('href="https://notes.example.test/"');
  });

  it.each([
    ["a script tag", "<script>alert(1)</script>"],
    ["an inline event handler", '<img src="x" onerror="alert(1)">'],
    ["raw HTML", '<div onclick="alert(1)">Hi</div>'],
    ["an iframe", '<iframe src="https://evil.example.test/"></iframe>'],
  ])("never renders %s as HTML", (_label, markdown) => {
    const html = render(markdown);

    expect(html).not.toMatch(/<(script|img|div|iframe)/i);
    expect(html).not.toMatch(/onerror|onclick/i);
  });

  it.each([
    ["javascript:", "[Click](javascript:alert(1))"],
    ["a mixed-case javascript:", "[Click](JaVaScRiPt:alert(1))"],
    ["data:", "[Click](data:text/html;base64,PHNjcmlwdD4=)"],
    ["vbscript:", "[Click](vbscript:msgbox(1))"],
  ])("drops a %s link target", (_label, markdown) => {
    const html = render(markdown);

    expect(html).not.toMatch(/javascript:|data:|vbscript:/i);
    expect(html).toContain("Click");
  });

  it("keeps headings and images out, leaving their text", () => {
    const html = render("## A heading\n\n![A picture](https://images.example.test/a.png)");

    expect(html).not.toMatch(/<h\d|<img/);
    expect(html).toContain("A heading");
  });
});
