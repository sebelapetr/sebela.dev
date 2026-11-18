import { describe, expect, it } from "vitest";

import { contentChangeActions, contentDomains, type ContentChange } from "@sebela/contracts";

import { dependencyMap, scopesFor } from "./dependencies";

describe("dependencyMap", () => {
  it("names the profile scope for every content domain the API can report", () => {
    expect(Object.keys(dependencyMap).sort()).toEqual([...contentDomains].sort());
    for (const domain of contentDomains) {
      expect(dependencyMap[domain]).toEqual(["profile"]);
    }
  });
});

describe("scopesFor", () => {
  it("gives each affected scope once, however many changes name it", () => {
    const changes: ContentChange[] = [
      { domain: "person", record: null, action: "updated" },
      { domain: "experience", record: "fictional-role", action: "updated" },
      { domain: "project", record: "fictional-project", action: "deleted" },
    ];

    expect(scopesFor(changes)).toEqual(["profile"]);
  });

  it.each(contentChangeActions)(
    "covers former dependants: a change that was %s invalidates the whole profile",
    (action) => {
      expect(scopesFor([{ domain: "service", record: "fictional-service", action }])).toEqual([
        "profile",
      ]);
    },
  );

  it("never takes a scope, address or cache key from the record it names", () => {
    const records = ["homepage", "profile", "everything", "sitemap-xml", "llms-txt"];
    for (const record of records) {
      expect(scopesFor([{ domain: "topic", record, action: "updated" }])).toEqual(["profile"]);
    }
    expect(
      scopesFor([
        { domain: "media", record: "3d1f0c0e-6c1b-4a51-9a52-1c8e8c5b2f10", action: "deleted" },
      ]),
    ).toEqual(["profile"]);
  });
});
