// Behaviour of the release decisions (docs/release-workflow.md, "Images"): which services a push
// to master affects, and which images a release builds and which current images it reuses. The
// fixtures hold real `turbo query affected --packages` output, captured on synthetic commits of
// this repository, with the files each commit changed and the services it must select. The command
// line around these decisions (Turborepo, git, docker) is exercised by the release workflow.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  SERVICES,
  affectedPackages,
  affectedServices,
  comparisonBase,
  formatOutputs,
  releasePlan,
} from "./images.mjs";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "affected-services");
const fixtures = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) }));

const SHA = "0123456789abcdef0123456789abcdef01234567";
const API_SHA = "1111111111111111111111111111111111111111";
const MCP_SHA = "2222222222222222222222222222222222222222";

describe("affected services", () => {
  it("has the fixtures the issue names", () => {
    const names = fixtures.map(({ name }) => name);
    for (const name of ["single-app", "shared-package", "docs-only", "workflow-only"]) {
      assert.ok(names.includes(`${name}.json`), `fixture ${name}`);
    }
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      assert.deepEqual(
        affectedServices({
          packages: affectedPackages(fixture.turbo),
          changedFiles: fixture.changedFiles,
        }),
        fixture.services,
      );
    });
  }

  it("selects every service when there is no comparison base", () => {
    assert.deepEqual(affectedServices({ packages: null, changedFiles: null }), SERVICES);
    assert.deepEqual(affectedServices({ packages: [], changedFiles: null }), SERVICES);
    assert.deepEqual(affectedServices({ packages: null, changedFiles: [] }), SERVICES);
  });

  it("lists the services in a fixed order", () => {
    assert.deepEqual(SERVICES, ["api", "web", "mcp-admin"]);
    assert.deepEqual(
      affectedServices({ packages: ["@sebela/mcp-admin", "@sebela/api"], changedFiles: [] }),
      ["api", "mcp-admin"],
    );
  });

  it("refuses output that is not Turborepo's affected packages", () => {
    assert.throws(() => affectedPackages({}), /affected packages/);
    assert.throws(() => affectedPackages({ data: { affectedPackages: { items: [{}] } } }));
    assert.throws(() => affectedPackages(null));
  });
});

describe("comparison base", () => {
  it("is the commit before the push", () => {
    assert.equal(comparisonBase(SHA), SHA);
  });

  it("is missing for a new branch or an empty value", () => {
    assert.equal(comparisonBase("0000000000000000000000000000000000000000"), null);
    assert.equal(comparisonBase(""), null);
    assert.equal(comparisonBase(undefined), null);
  });

  it("refuses anything but a commit SHA", () => {
    assert.throws(() => comparisonBase("HEAD~1"), /commit SHA/);
    assert.throws(() => comparisonBase("--output=x"), /commit SHA/);
  });
});

describe("release plan", () => {
  it("builds the affected services and reuses the current images of the others", () => {
    assert.deepEqual(
      releasePlan({ sha: SHA, affected: ["web"], current: { api: API_SHA, "mcp-admin": MCP_SHA } }),
      {
        build: ["web"],
        reuse: ["api", "mcp-admin"],
        tags: { api: API_SHA, web: SHA, "mcp-admin": MCP_SHA },
      },
    );
  });

  it("builds an unchanged service that has no current image yet", () => {
    assert.deepEqual(
      releasePlan({ sha: SHA, affected: ["web"], current: { api: null, "mcp-admin": MCP_SHA } }),
      {
        build: ["api", "web"],
        reuse: ["mcp-admin"],
        tags: { api: SHA, web: SHA, "mcp-admin": MCP_SHA },
      },
    );
    assert.deepEqual(releasePlan({ sha: SHA, affected: ["api"], current: {} }).build, SERVICES);
  });

  it("builds an unchanged service whose current image names no commit", () => {
    assert.deepEqual(
      releasePlan({
        sha: SHA,
        affected: ["api"],
        current: { web: "latest", "mcp-admin": `${MCP_SHA}\n` },
      }).build,
      SERVICES,
    );
  });

  it("builds every service when all are affected, whatever is current", () => {
    assert.deepEqual(releasePlan({ sha: SHA, affected: SERVICES, current: { api: API_SHA } }), {
      build: SERVICES,
      reuse: [],
      tags: { api: SHA, web: SHA, "mcp-admin": SHA },
    });
  });

  it("refuses a malformed commit or an unknown service", () => {
    assert.throws(() => releasePlan({ sha: "main", affected: ["api"], current: {} }), /commit/);
    assert.throws(
      () => releasePlan({ sha: SHA, affected: ["ai-service"], current: {} }),
      /unknown service/,
    );
  });
});

describe("workflow outputs", () => {
  it("writes one key=value line per output, values as JSON", () => {
    assert.equal(
      formatOutputs({ services: ["web"], build: true, tags: { web: SHA } }),
      `services=["web"]\nbuild=true\ntags={"web":"${SHA}"}\n`,
    );
  });
});
