// Behaviour of the decision whether a pull request runs the paid MCP Admin model evals, observed
// through its command line in a disposable Git repository: a base commit with a small fictional
// OpenAPI document, MCP Admin sources that call some of its routes and a lockfile, then a head
// commit with one kind of change. The last test keeps the derivation honest against the real
// MCP Admin sources and the committed OpenAPI document.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { routesCalledBy } from "./mcp-admin-evals-affected.mjs";

const CHECK = path.join(import.meta.dirname, "mcp-admin-evals-affected.mjs");
const REPOSITORY = path.resolve(import.meta.dirname, "..", "..");
const OPENAPI = "packages/api-client/src/generated/openapi.json";

const errorResponses = {
  404: {
    description: "`not_found`",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
};

/** The base OpenAPI document: two routes MCP Admin calls and one it does not. */
function baseDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Fixture API", version: "1.0.0" },
    paths: {
      "/v1/person": {
        get: {
          operationId: "getPerson",
          security: [],
          responses: {
            200: {
              description: "The person.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Person" } } },
            },
            ...errorResponses,
          },
        },
      },
      "/v1/projects/{slug}": {
        patch: {
          operationId: "updateProject",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "slug", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ProjectUpdate" } },
            },
          },
          responses: { 200: { description: "The project." }, ...errorResponses },
        },
      },
      "/v1/chat/conversations": {
        post: {
          operationId: "createConversation",
          security: [],
          responses: { 201: { description: "A conversation." }, ...errorResponses },
        },
      },
    },
    components: {
      schemas: {
        Person: {
          type: "object",
          properties: { name: { type: "string" }, links: { $ref: "#/components/schemas/Links" } },
        },
        Links: { type: "array", items: { type: "string" } },
        ProjectUpdate: {
          type: "object",
          properties: { title: { type: "string", maxLength: 200 } },
          additionalProperties: false,
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", enum: ["not_found", "rate_limited", "unavailable"] },
                message: { type: "string" },
              },
            },
          },
        },
      },
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
  };
}

const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      turbo:
        specifier: 2.0.0
        version: 2.0.0

  apps/api:
    dependencies:
      hono:
        specifier: 'catalog:'
        version: 4.0.0

  apps/mcp-admin:
    dependencies:
      hono:
        specifier: 'catalog:'
        version: 4.0.0

  packages/api-client:
    dependencies:
      openapi-fetch:
        specifier: 0.17.0
        version: 0.17.0

packages:

  hono@4.0.0:
    resolution: {integrity: sha512-fixture}
`;

const WORKFLOW = `name: Model evals

on:
  pull_request:
    branches:
      - master

jobs:
  # Which suites the pull request affects.
  changes:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/checks/mcp-admin-evals-affected.mjs "$BASE" HEAD

  mcp-admin:
    name: MCP Admin model evals
    needs: changes
    steps:
      - run: node evals/run.js
`;

const CLIENT = `import createClient from "openapi-fetch";

export type Person = Schemas["Person"];

export function createApiClient(options) {
  return createClient(options);
}
`;

function baseFiles() {
  return {
    [OPENAPI]: `${JSON.stringify(baseDocument(), null, 2)}\n`,
    "pnpm-lock.yaml": LOCKFILE,
    "packages/api-client/src/index.ts": CLIENT,
    "apps/mcp-admin/package.json": '{ "name": "@sebela/mcp-admin" }\n',
    "apps/mcp-admin/src/modules/content/registry.ts":
      'export const routes = { get: "/v1/person", update: "/v1/projects/{slug}" };\n',
    "apps/mcp-admin/evals/state.js":
      "export const read = (slug) => fetch(`/v1/projects/${slug}`);\n",
    // Tests and their fakes call routes that MCP Admin itself never calls.
    "apps/mcp-admin/src/app.test.ts": 'fetch("/v1/chat/conversations");\n',
    "apps/mcp-admin/src/test-support/fake-api.ts": 'route("/v1/chat/conversations");\n',
    "apps/api/src/routes.ts": "export {};\n",
    ".github/workflows/model-evals.yml": WORKFLOW,
  };
}

/** A repository with the base files committed, then `change` applied and committed as head. */
function repository(t, change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-mcp-admin-evals-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      encoding: "utf8",
    });
  const write = (files) => {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, name);
      if (content === null) {
        fs.rmSync(file);
        continue;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  };
  const commit = () => {
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "x",
    );
    return git("rev-parse", "HEAD").trim();
  };
  git("init", "-b", "master");
  write(baseFiles());
  const base = commit();
  write(change);
  commit();
  return { root, base };
}

function decide(root, args) {
  const result = spawnSync(process.execPath, [CHECK, ...args], { cwd: root, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    output: `${result.stdout}${result.stderr}`,
  };
}

/** Commits `change` over the base and returns the decision for base...HEAD. */
function affected(t, change) {
  const { root, base } = repository(t, change);
  const result = decide(root, [base, "HEAD"]);
  assert.equal(result.status, 0, result.output);
  const verdict = /^mcp-admin=(true|false)$/m.exec(result.stdout);
  assert.ok(verdict, `no mcp-admin=<true|false> line:\n${result.output}`);
  return { affected: verdict[1] === "true", output: result.output };
}

function documentWith(edit) {
  const document = baseDocument();
  edit(document);
  return { [OPENAPI]: `${JSON.stringify(document, null, 2)}\n` };
}

describe("MCP Admin model evals: affected or not", () => {
  it("is not affected by an additive route MCP Admin does not call, with its API and contracts", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.paths["/v1/retrieval/search"] = {
          post: {
            operationId: "searchKnowledge",
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/SearchRequest" } },
              },
            },
            responses: { 200: { description: "Passages." }, ...errorResponses },
          },
        };
        document.components.schemas.SearchRequest = { type: "object" };
        // The route's new error codes join the shared catalogue every route refers to.
        document.components.schemas.ErrorResponse.properties.error.properties.code.enum.splice(
          2,
          0,
          "provider_unavailable",
        );
      }),
      "apps/api/src/routes.ts": "export const search = true;\n",
      "packages/contracts/src/modules/retrieval/index.ts": "export const SearchRequest = {};\n",
      "packages/services/src/modules/retrieval/index.ts": "export {};\n",
      "packages/db/src/schema/retrieval.ts": "export {};\n",
      "pnpm-lock.yaml": LOCKFILE.replace(
        "\npackages:\n",
        "\n  packages/memory:\n    dependencies:\n      pdfjs-dist:\n        specifier: 6.5.438\n        version: 6.5.438\n\npackages:\n",
      ),
      "packages/api-client/src/index.ts": CLIENT.replace(
        'export type Person = Schemas["Person"];\n',
        'export type Person = Schemas["Person"];\nexport type SearchRequest = Schemas["SearchRequest"];\n',
      ),
    });
    assert.equal(result.affected, false, result.output);
  });

  it("is not affected by a changed route only MCP Admin's tests call", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.paths["/v1/chat/conversations"].post.responses[201].description = "Changed.";
      }),
    });
    assert.equal(result.affected, false, result.output);
  });

  it("is affected by a changed response schema of a route MCP Admin calls, and names it", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        // Reached only through Person -> Links: references are followed.
        document.components.schemas.Links.items = { type: "string", format: "uri" };
      }),
    });
    assert.equal(result.affected, true, result.output);
    assert.match(result.output, /\/v1\/person/);
  });

  it("is affected by a changed request schema of a route MCP Admin calls", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.components.schemas.ProjectUpdate.properties.title.maxLength = 120;
      }),
    });
    assert.equal(result.affected, true, result.output);
    assert.match(result.output, /\/v1\/projects\/\{slug\}/);
  });

  it("is affected by a changed operation of a route MCP Admin calls", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.paths["/v1/projects/{slug}"].patch.security = [];
      }),
    });
    assert.equal(result.affected, true, result.output);
  });

  it("is affected when a route MCP Admin calls is removed", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        delete document.paths["/v1/person"];
      }),
    });
    assert.equal(result.affected, true, result.output);
    assert.match(result.output, /\/v1\/person/);
  });

  it("is affected when an error code leaves the shared catalogue", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.components.schemas.ErrorResponse.properties.error.properties.code.enum = [
          "not_found",
          "unavailable",
        ];
      }),
    });
    assert.equal(result.affected, true, result.output);
    assert.match(result.output, /rate_limited/);
  });

  it("is affected by any other change to the shared error shape", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.components.schemas.ErrorResponse.properties.error.properties.fields = {
          type: "array",
        };
      }),
    });
    assert.equal(result.affected, true, result.output);
  });

  it("is affected by a changed security scheme", (t) => {
    const result = affected(t, {
      ...documentWith((document) => {
        document.components.securitySchemes.bearerAuth.scheme = "basic";
      }),
    });
    assert.equal(result.affected, true, result.output);
  });

  for (const [what, file] of [
    ["its code", "apps/mcp-admin/src/modules/tools/index.ts"],
    ["its evals", "apps/mcp-admin/evals/catalogue.js"],
    ["its eval fixtures", "apps/mcp-admin/evals/fixtures/s01/person.json"],
    ["its package.json", "apps/mcp-admin/package.json"],
    ["its documentation", "apps/mcp-admin/AGENTS.md"],
  ]) {
    it(`is affected by a change in apps/mcp-admin/ (${what}) and names the file`, (t) => {
      const result = affected(t, { [file]: "changed\n" });
      assert.equal(result.affected, true, result.output);
      assert.match(result.output, new RegExp(file.replaceAll(".", "\\.")));
    });
  }

  it("is affected by a change to the mcp-admin job of the model evals workflow", (t) => {
    const result = affected(t, {
      ".github/workflows/model-evals.yml": WORKFLOW.replace(
        "      - run: node evals/run.js\n",
        "      - run: node evals/run.js --case E01\n",
      ),
    });
    assert.equal(result.affected, true, result.output);
    assert.match(result.output, /mcp-admin job/);
  });

  it("is affected when the mcp-admin job is removed from the workflow", (t) => {
    const result = affected(t, {
      ".github/workflows/model-evals.yml": WORKFLOW.slice(0, WORKFLOW.indexOf("  mcp-admin:")),
    });
    assert.equal(result.affected, true, result.output);
  });

  it("is not affected by the mcp-admin job moving within the workflow", (t) => {
    const [head, job] = WORKFLOW.split("\n  mcp-admin:\n");
    const moved = head.replace("jobs:\n", `jobs:\n  mcp-admin:\n${job}\n`);
    const result = affected(t, { ".github/workflows/model-evals.yml": moved });
    assert.equal(result.affected, false, result.output);
  });

  it("is not affected by an edit of the changes job or the rest of the workflow", (t) => {
    const result = affected(t, {
      ".github/workflows/model-evals.yml": WORKFLOW.replace(
        "  changes:\n    runs-on: ubuntu-latest\n",
        "  changes:\n    runs-on: ubuntu-latest\n    outputs:\n      llm-agent: x\n",
      ).replace("      - master\n", "      - master\n    types: [opened]\n"),
    });
    assert.equal(result.affected, false, result.output);
  });

  it("is not affected by another job added to the workflow", (t) => {
    const result = affected(t, {
      ".github/workflows/model-evals.yml": `${WORKFLOW}\n  llm-agent:\n    name: Python agent model evals\n    needs: changes\n    steps:\n      - run: uv run python -m evals.run\n`,
    });
    assert.equal(result.affected, false, result.output);
  });

  it("is not affected by a change to this decision itself", (t) => {
    const result = affected(t, {
      "scripts/checks/mcp-admin-evals-affected.mjs": "// changed\n",
      "scripts/checks/mcp-admin-evals-affected.test.mjs": "// changed\n",
    });
    assert.equal(result.affected, false, result.output);
  });

  it("is affected by a changed dependency of MCP Admin or of its API client in the lockfile", (t) => {
    for (const [importer, from, to] of [
      [
        "apps/mcp-admin",
        "  apps/mcp-admin:\n    dependencies:\n      hono:\n        specifier: 'catalog:'\n        version: 4.0.0\n",
        "  apps/mcp-admin:\n    dependencies:\n      hono:\n        specifier: 'catalog:'\n        version: 4.1.0\n",
      ],
      ["packages/api-client", "version: 0.17.0", "version: 0.18.0"],
    ]) {
      const result = affected(t, { "pnpm-lock.yaml": LOCKFILE.replace(from, to) });
      assert.equal(result.affected, true, `${importer}\n${result.output}`);
      assert.match(result.output, new RegExp(importer));
    }
  });

  it("is not affected by a lockfile change of another importer", (t) => {
    const result = affected(t, {
      "pnpm-lock.yaml": LOCKFILE.replace(
        "  apps/api:\n    dependencies:\n      hono:\n        specifier: 'catalog:'\n        version: 4.0.0\n",
        "  apps/api:\n    dependencies:\n      hono:\n        specifier: 'catalog:'\n        version: 4.1.0\n",
      ),
    });
    assert.equal(result.affected, false, result.output);
  });

  it("is affected by a change to the API client's runtime, not by a new type export", (t) => {
    const runtime = affected(t, {
      "packages/api-client/src/index.ts": CLIENT.replace(
        "return createClient(options);",
        "return createClient({ ...options, credentials: 'omit' });",
      ),
    });
    assert.equal(runtime.affected, true, runtime.output);
    assert.match(runtime.output, /packages\/api-client\/src\/index\.ts/);
    const manifest = affected(t, { "packages/api-client/package.json": "{}\n" });
    assert.equal(manifest.affected, true, manifest.output);
  });

  it("refuses to decide without a base it can read", (t) => {
    const { root } = repository(t, {});
    const missing = decide(root, []);
    assert.equal(missing.status, 2, missing.output);
    const unknown = decide(root, ["0000000000000000000000000000000000000000", "HEAD"]);
    assert.notEqual(unknown.status, 0, unknown.output);
    assert.doesNotMatch(unknown.stdout, /mcp-admin=/);
  });
});

describe("MCP Admin's called routes in this repository", () => {
  it("are found in its sources and every route literal names a documented route", () => {
    const document = JSON.parse(fs.readFileSync(path.join(REPOSITORY, OPENAPI), "utf8"));
    const documented = Object.keys(document.paths);
    const sources = [];
    for (const folder of ["apps/mcp-admin/src", "apps/mcp-admin/evals"]) {
      for (const entry of fs.readdirSync(path.join(REPOSITORY, folder), { recursive: true })) {
        const name = `${folder}/${entry}`;
        if (fs.statSync(path.join(REPOSITORY, name)).isFile()) {
          sources.push({ name, text: fs.readFileSync(path.join(REPOSITORY, name), "utf8") });
        }
      }
    }
    const { called, unmatched } = routesCalledBy(sources, documented);
    // The routes MCP Admin's tools and evals cannot work without.
    for (const route of [
      "/v1/authentication",
      "/v1/audit/changes",
      "/v1/person",
      "/v1/projects/{slug}",
      "/v1/projects/{slug}/case-study",
      "/v1/media",
      "/v1/roadmap/sessions",
      "/v1/roadmap/diary/{date}",
      "/v1/roadmap/time-entries/{id}",
    ]) {
      assert.ok(called.includes(route), `${route} is not among ${called.join(", ")}`);
    }
    assert.ok(!called.includes("/v1/retrieval/search"), "retrieval search is not MCP Admin's");
    // Wildcard patterns of its own audit lookups are the only literals that name no route; any
    // other unmatched literal means a call the derivation would miss.
    assert.deepEqual(
      unmatched.filter((literal) => !literal.endsWith("/*")),
      [],
      "route literals that match no documented route",
    );
  });
});
