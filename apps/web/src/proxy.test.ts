import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://site.example.test"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("asks search engines not to index any response by default", () => {
    vi.stubEnv("WEB_INDEXING", undefined);
    expect(proxy(request("/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(proxy(request("/robots.txt")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("keeps responses out of search engines when WEB_INDEXING is off or unusable", () => {
    vi.stubEnv("WEB_INDEXING", "off");
    expect(proxy(request("/experience")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    vi.stubEnv("WEB_INDEXING", "yes");
    expect(proxy(request("/experience")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("adds no robots header when WEB_INDEXING is on, and lets the request through", () => {
    vi.stubEnv("WEB_INDEXING", "on");
    const response = proxy(request("/services"));
    expect(response.headers.get("x-robots-tag")).toBeNull();
    // `NextResponse.next()` continues to the page rather than answering or redirecting.
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
