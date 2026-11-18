import { describe, expect, it } from "vitest";

import type { Service } from "@sebela/api-client";

import { toServicesSummary } from "./services-summary";

const STAMP = "2026-01-01T00:00:00.000Z";

/** A fictional service as the public list returns it. */
function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "1b6c8d0e-2f4a-4b7c-9d5e-6f8a0b2c4d76",
    slug: "fictional-service",
    name: "Fictional service",
    summary: "A **made-up** service.",
    audience: "Fictional teams.",
    deliverable: "A fictional tool.",
    position: 0,
    evidence: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe("toServicesSummary", () => {
  it("numbers the services in the API's order with their summary and their place on the services page", () => {
    expect(
      toServicesSummary([
        service({ slug: "automation", name: "Automation" }),
        service({ slug: "custom-software", name: "Custom software", summary: "Built to fit." }),
      ]),
    ).toEqual([
      {
        slug: "automation",
        number: "01",
        name: "Automation",
        summary: "A **made-up** service.",
        href: "/services#service-automation",
      },
      {
        slug: "custom-software",
        number: "02",
        name: "Custom software",
        summary: "Built to fit.",
        href: "/services#service-custom-software",
      },
    ]);
  });

  it("leaves out the audience, the deliverable and the evidence the services page shows", () => {
    const [summary] = toServicesSummary([service()]);

    expect(Object.keys(summary ?? {})).toEqual(["slug", "number", "name", "summary", "href"]);
  });

  it("is empty without services", () => {
    expect(toServicesSummary([])).toEqual([]);
  });
});
