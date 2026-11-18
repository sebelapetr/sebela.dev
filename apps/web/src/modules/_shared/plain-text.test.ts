import { describe, expect, it } from "vitest";

import { plainText } from "./plain-text";

describe("plainText", () => {
  it("keeps the words of inline Markdown without its marks or link targets", () => {
    expect(
      plainText("Built **fictional** systems for [made-up](https://example.test) `code`."),
    ).toBe("Built fictional systems for made-up code.");
  });

  it("keeps the first paragraph on one line, without heading or list marks", () => {
    expect(plainText("# A heading\n- first line\n- second line\n\nAnother paragraph.")).toBe(
      "A heading first line second line",
    );
  });

  it("cuts a long text at a word, ending it with an ellipsis within the limit", () => {
    const text = plainText("alpha beta gamma delta epsilon", 17);
    expect(text).toBe("alpha beta gamma…");
    expect(text.length).toBeLessThanOrEqual(17);
  });

  it("leaves markup that is not Markdown as plain characters, never as markup", () => {
    expect(plainText("A <script>alert(1)</script> note")).toBe("A <script>alert(1)</script> note");
  });

  it("gives nothing for a text without words", () => {
    expect(plainText("  \n\n **  ** ")).toBe("");
  });
});
