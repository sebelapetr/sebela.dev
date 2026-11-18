import { describe, expect, it } from "vitest";

import { canonicalPath, externalReferrer, redactPayload } from "./redact";

const SITE = "https://site.example.test";
// A fictional conversation identifier, as the chat puts it in the Ask page's address.
const CONVERSATION = "c0ffee00-1234-4abc-8def-001122334455";

describe("canonicalPath", () => {
  it.each([
    ["/", "/"],
    ["/experience", "/experience"],
    ["/ask?c=" + CONVERSATION, "/ask"],
    ["/experience#project-fictional-shop", "/experience"],
    ["/services?utm_source=newsletter#consulting", "/services"],
    [`${SITE}/ask?c=${CONVERSATION}#latest`, "/ask"],
    [SITE, "/"],
  ])("reports %s as %s", (url, path) => {
    expect(canonicalPath(url, SITE)).toBe(path);
  });

  it("reports the root for something that is not an address", () => {
    expect(canonicalPath("http://", SITE)).toBe("/");
  });
});

describe("externalReferrer", () => {
  it("keeps only another site's origin", () => {
    expect(
      externalReferrer("https://search.example.test/results?q=fictional+person#top", SITE),
    ).toBe("https://search.example.test");
  });

  it.each([
    ["empty", ""],
    ["the site itself", `${SITE}/ask?c=${CONVERSATION}`],
    ["a path on the site", `/ask?c=${CONVERSATION}`],
    ["not an address", "not a url"],
    ["another scheme", "android-app://example.test/"],
  ])("drops a referrer that is %s", (_label, referrer) => {
    expect(externalReferrer(referrer, SITE)).toBe("");
  });
});

describe("redactPayload", () => {
  const payload = {
    website: "0b6e1d6c-4f3a-4c8e-9d2b-7a5f3e1c2b4a",
    hostname: "site.example.test",
    screen: "1280x720",
    language: "en",
    title: "Ask AI",
    url: `${SITE}/ask?c=${CONVERSATION}#latest`,
    referrer: `${SITE}/experience?from=hero`,
  };

  it("reports the canonical path and no referrer from the site itself", () => {
    expect(redactPayload(payload, SITE)).toEqual({ ...payload, url: "/ask", referrer: "" });
  });

  it("keeps only an external referrer's origin", () => {
    expect(
      redactPayload({ ...payload, referrer: "https://search.example.test/?q=x" }, SITE)["referrer"],
    ).toBe("https://search.example.test");
  });

  it("leaves out everything but the page view's own fields", () => {
    const redacted = redactPayload(
      { ...payload, name: "question", data: { text: "What did the fictional person build?" } },
      SITE,
    );
    expect(Object.keys(redacted).sort()).toEqual(
      ["hostname", "language", "referrer", "screen", "title", "url", "website"].sort(),
    );
    expect(JSON.stringify(redacted)).not.toContain("fictional person");
  });

  it("keeps a missing field missing and drops a field that is not text", () => {
    const redacted = redactPayload({ website: payload.website, url: "/cv?x=1", screen: 5 }, SITE);
    expect(redacted).toEqual({ website: payload.website, url: "/cv", referrer: "" });
  });
});
