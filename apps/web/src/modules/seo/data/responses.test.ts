import { describe, expect, it } from "vitest";

import type { HomepageProfile, HomepageResult } from "../../profile";
import { profileTextResponse, textResponse } from "./responses";

const PROFILE: HomepageProfile = {
  name: "Robin Example",
  headline: "Fictional engineer for tests",
  shortBio: "Robin is made up.",
  photo: null,
  contact: { email: null, links: [] },
  careerStartedOn: null,
  experiences: [],
  projects: [],
  technologies: [],
  currentFocus: [],
  explorations: [],
  currentLearning: [],
  services: [],
  cvPdf: null,
};

const TEXT = "text/plain; charset=utf-8";

describe("profileTextResponse", () => {
  it("serves what the profile renders to", async () => {
    const response = profileTextResponse(
      { status: "ready", profile: PROFILE },
      TEXT,
      ({ profile }) => `# ${profile.name}\n`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(TEXT);
    expect(response.headers.get("Cache-Control")).toMatch(/^public, /u);
    expect(await response.text()).toBe("# Robin Example\n");
  });

  it("answers 404 for a profile that is not published, without content", async () => {
    const response = profileTextResponse({ status: "missing" }, TEXT, () => "unused");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    // Never kept by a shared cache, so a page published a moment later shows at once.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("unused");
  });

  it("answers 503 while the API cannot be read: never a successful empty document", async () => {
    const result: HomepageResult = { status: "unavailable" };
    const response = profileTextResponse(result, TEXT, () => "unused");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await response.text()).not.toContain("unused");
  });
});

describe("textResponse", () => {
  it("serves the body with its content type", async () => {
    const response = textResponse("User-agent: *\n", TEXT);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(TEXT);
    expect(await response.text()).toBe("User-agent: *\n");
  });

  it("lets the CDN keep the document briefly, so a content change or the indexing switch shows", () => {
    const response = textResponse("User-agent: *\n", TEXT);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=86400",
    );
  });
});
