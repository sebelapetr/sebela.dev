import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("asks search engines not to index any response by default", () => {
    vi.stubEnv("WEB_INDEXING", undefined);
    expect(proxy().headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("keeps responses out of search engines when WEB_INDEXING is off or unusable", () => {
    vi.stubEnv("WEB_INDEXING", "off");
    expect(proxy().headers.get("x-robots-tag")).toBe("noindex, nofollow");
    vi.stubEnv("WEB_INDEXING", "yes");
    expect(proxy().headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("adds no robots header when WEB_INDEXING is on, and lets the request through", () => {
    vi.stubEnv("WEB_INDEXING", "on");
    const response = proxy();
    expect(response.headers.get("x-robots-tag")).toBeNull();
    // `NextResponse.next()` continues to the page rather than answering or redirecting.
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
