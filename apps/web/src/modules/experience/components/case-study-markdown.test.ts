import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaseStudyMarkdown } from "./case-study-markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(CaseStudyMarkdown, { children: markdown }));
}

describe("CaseStudyMarkdown", () => {
  it("demotes the body's sections to h5 below the project's heading", () => {
    const html = render("# Top\n\n## Context\n\nA **fictional** account.\n\n### Detail\n\nMore.");

    expect(html).not.toMatch(/<h[1-4]/);
    expect(html.match(/<h5/g)).toHaveLength(3);
    expect(html).toContain("Context");
    expect(html).toContain("<strong");
  });

  it("renders lists, code and web links", () => {
    const html = render("- one\n\n`code` [Notes](https://notes.example.test/)");

    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code");
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

  it("keeps images and tables out, leaving their text", () => {
    const html = render(
      "![A picture](https://images.example.test/a.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    );

    expect(html).not.toMatch(/<img|<table/);
  });
});
