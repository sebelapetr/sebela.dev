import { describe, expect, it } from "vitest";

import { createAnalyticsSettings } from "./settings";

const SITE = { WEB_SITE_ORIGIN: "https://site.example.test" };
const SCRIPT = "https://analytics.example.test/script.js";
const WEBSITE = "0b6e1d6c-4f3a-4c8e-9d2b-7a5f3e1c2b4a";

function settings() {
  const lines: string[] = [];
  const read = createAnalyticsSettings((line) => lines.push(line));
  return { read, lines };
}

describe("createAnalyticsSettings", () => {
  it("hands over valid settings", () => {
    const { read, lines } = settings();
    expect(
      read({ ...SITE, WEB_ANALYTICS_SCRIPT_URL: SCRIPT, WEB_ANALYTICS_WEBSITE_ID: WEBSITE }),
    ).toEqual({ scriptUrl: SCRIPT, websiteId: WEBSITE });
    expect(lines).toEqual([]);
  });

  it("omits the integration without settings and says nothing", () => {
    const { read, lines } = settings();
    expect(read(SITE)).toBeNull();
    expect(lines).toEqual([]);
  });

  it("omits the integration with an unusable setting and reports it once, without its value", () => {
    const { read, lines } = settings();
    const env = { ...SITE, WEB_ANALYTICS_SCRIPT_URL: SCRIPT, WEB_ANALYTICS_WEBSITE_ID: "s3cret" };
    expect(read(env)).toBeNull();
    expect(read(env)).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/analytics is off: .*WEB_ANALYTICS_WEBSITE_ID must be a UUID/);
    expect(lines[0]).not.toContain("s3cret");
  });
});
