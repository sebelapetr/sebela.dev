// Behaviour of the decision whether a pull request runs the paid Python agent model evals,
// observed through its command line in a disposable Git repository: a base commit with a small
// fictional OpenAPI document, agent sources that import some of its operations from the generated
// Python client, then a head commit with one kind of change. The last test keeps the derivation
// honest against the real agent sources and the committed OpenAPI document.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { operationsCalledBy } from "./llm-agent-evals-affected.mjs";

const CHECK = path.join(import.meta.dirname, "llm-agent-evals-affected.mjs");
const REPOSITORY = path.resolve(import.meta.dirname, "..", "..");
const SCRATCH = path.join(REPOSITORY, ".tmp", "checks");
const OPENAPI = "packages/api-client/src/generated/openapi.json";

const errorResponses = {
  404: {
    description: "`not_found`",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
};

/** The base OpenAPI document: a route the agent reads, its write sibling and another route. */
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
        patch: {
          operationId: "updatePerson",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Updated." }, ...errorResponses },
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
        Person: { type: "object", properties: { name: { type: "string" } } },
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", enum: ["not_found", "unavailable"] },
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

const WORKFLOW = `name: Model evals

jobs:
  changes:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/checks/llm-agent-evals-affected.mjs "$BASE" HEAD

  llm-agent:
    name: Python agent model evals
    needs: changes
    steps:
      - run: uv run --locked python -m evals.run --all
`;

const CONTENT = `from sebela_api_client import Client
from sebela_api_client.api.default import (
    get_person,
)
`;

function baseFiles() {
  return {
    [OPENAPI]: `${JSON.stringify(baseDocument(), null, 2)}\n`,
    "pyproject.toml": "[tool.uv.workspace]\n",
    "uv.lock": "version = 1\n",
    ".python-version": "3.14\n",
    "packages/llm-agent/AGENTS.md": "# llm-agent\n",
    "packages/llm-agent/pyproject.toml": '[project]\nname = "llm-agent"\n',
    "packages/llm-agent/src/llm_agent/tools/content.py": CONTENT,
    "packages/llm-agent/src/llm_agent/prompts/chat.py": 'CHAT_PROMPT = "Answer."\n',
    "packages/llm-agent/evals/run.py":
      "def check():\n    from sebela_api_client.api.default import get_person\n",
    "packages/llm-agent/evals/README.md": "Cases.\n",
    // A test imports an operation the agent itself never calls.
    "packages/llm-agent/tests/test_chat.py":
      "from sebela_api_client.api.default import create_conversation\n",
    "packages/api-client-python/AGENTS.md": "# client\n",
    "packages/api-client-python/content-api-client.yaml": "post_hooks: []\n",
    "packages/api-client-python/src/sebela_api_client/client.py": "class Client: ...\n",
    "packages/api-client-python/src/sebela_api_client/api/default/get_person.py": "# get\n",
    "packages/api-client-python/src/sebela_api_client/api/default/create_conversation.py": "#\n",
    "apps/ai-service/src/ai_service/app.py": "app = None\n",
    "apps/api/src/routes.ts": "export {};\n",
    ".github/workflows/model-evals.yml": WORKFLOW,
  };
}

/** A repository with the base files committed, then `change` applied and committed as head. */
function repository(t, change) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, "llm-agent-evals-"));
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
  const verdict = /^llm-agent=(true|false)$/m.exec(result.stdout);
  assert.ok(verdict, result.output);
  return { affected: verdict[1] === "true", output: result.output };
}

/** The base document with `edit` applied, serialized as the committed file. */
function documentWith(edit) {
  const document = baseDocument();
  edit(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

describe("whether a change runs the Python agent model evals", () => {
  const runs = [
    ["the agent's code", { "packages/llm-agent/src/llm_agent/tools/content.py": `${CONTENT}#\n` }],
    ["its prompts", { "packages/llm-agent/src/llm_agent/prompts/chat.py": 'CHAT_PROMPT = "A."\n' }],
    ["its evals", { "packages/llm-agent/evals/run.py": "def check():\n    pass\n" }],
    ["Markdown its evals read", { "packages/llm-agent/evals/README.md": "Other cases.\n" }],
    ["its package metadata", { "packages/llm-agent/pyproject.toml": '[project]\nname = "x"\n' }],
    [
      "the generated client's runtime",
      { "packages/api-client-python/src/sebela_api_client/client.py": "#\n" },
    ],
    [
      "the client's generator configuration",
      { "packages/api-client-python/content-api-client.yaml": "x: 1\n" },
    ],
    ["the workspace", { "pyproject.toml": "[tool.uv.workspace]\nmembers = []\n" }],
    ["the Python lockfile", { "uv.lock": "version = 2\n" }],
    ["the Python version", { ".python-version": "3.15\n" }],
    [
      "the llm-agent job",
      { ".github/workflows/model-evals.yml": WORKFLOW.replace("--all", "--all --stage issue") },
    ],
    [
      "a response schema of an operation it calls",
      {
        [OPENAPI]: documentWith((d) => {
          d.components.schemas.Person.properties.name.maxLength = 100;
        }),
      },
    ],
    [
      "an operation it calls",
      {
        [OPENAPI]: documentWith((d) => {
          d.paths["/v1/person"].get.parameters = [{ in: "query", name: "lang" }];
        }),
      },
    ],
    [
      "the removal of an operation it calls",
      {
        [OPENAPI]: documentWith((d) => {
          delete d.paths["/v1/person"].get;
        }),
      },
    ],
    [
      "a code removed from the shared error catalogue",
      {
        [OPENAPI]: documentWith((d) => {
          d.components.schemas.ErrorResponse.properties.error.properties.code.enum = ["not_found"];
        }),
      },
    ],
  ];
  for (const [what, change] of runs) {
    it(`runs them for ${what}`, (t) => {
      const result = affected(t, change);
      assert.equal(result.affected, true, result.output);
    });
  }

  const skips = [
    ["the agent's documentation", { "packages/llm-agent/AGENTS.md": "# llm-agent, more\n" }],
    ["the client's documentation", { "packages/api-client-python/AGENTS.md": "# more\n" }],
    ["the agent's tests", { "packages/llm-agent/tests/test_chat.py": "x = 1\n" }],
    [
      "a regenerated operation module (its contract is compared instead)",
      {
        "packages/api-client-python/src/sebela_api_client/api/default/create_conversation.py":
          "##\n",
      },
    ],
    [
      "the AI service, which the runner never loads",
      { "apps/ai-service/src/ai_service/app.py": "#\n" },
    ],
    ["the API's code", { "apps/api/src/routes.ts": "export const x = 1;\n" }],
    [
      "another job of the workflow",
      {
        ".github/workflows/model-evals.yml": WORKFLOW.replace(
          "--all\n",
          "--all\n\n  other:\n    steps: []\n",
        ),
      },
    ],
    [
      "the write sibling of a route it reads",
      {
        [OPENAPI]: documentWith((d) => {
          d.paths["/v1/person"].patch.description = "Changed.";
        }),
      },
    ],
    [
      "an operation only a test imports",
      {
        [OPENAPI]: documentWith((d) => {
          d.paths["/v1/chat/conversations"].post.description = "Changed.";
        }),
      },
    ],
    [
      "a code added to the shared error catalogue",
      {
        [OPENAPI]: documentWith((d) => {
          d.components.schemas.ErrorResponse.properties.error.properties.code.enum.push("busy");
        }),
      },
    ],
  ];
  for (const [what, change] of skips) {
    it(`does not run them for ${what}`, (t) => {
      const result = affected(t, change);
      assert.equal(result.affected, false, result.output);
    });
  }

  it("refuses wrong usage and prints no decision when Git cannot answer", (t) => {
    const { root } = repository(t, {});
    const missing = decide(root, []);
    assert.equal(missing.status, 2, missing.output);
    const unknown = decide(root, ["0000000000000000000000000000000000000000", "HEAD"]);
    assert.notEqual(unknown.status, 0, unknown.output);
    assert.doesNotMatch(unknown.stdout, /llm-agent=/);
  });
});

describe("the operations the Python agent calls in this repository", () => {
  it("are its allowlisted public reads, each one documented", () => {
    const document = JSON.parse(fs.readFileSync(path.join(REPOSITORY, OPENAPI), "utf8"));
    const sources = [];
    for (const folder of ["packages/llm-agent/src", "packages/llm-agent/evals"]) {
      for (const entry of fs.readdirSync(path.join(REPOSITORY, folder), { recursive: true })) {
        const name = `${folder}/${entry}`;
        if (name.endsWith(".py") && fs.statSync(path.join(REPOSITORY, name)).isFile()) {
          sources.push({ name, text: fs.readFileSync(path.join(REPOSITORY, name), "utf8") });
        }
      }
    }
    const { called, unmatched } = operationsCalledBy(sources, document);
    assert.deepEqual(unmatched, [], "imported client modules that name no documented operation");
    for (const operation of ["get /v1/person", "get /v1/projects/{slug}", "get /v1/roadmap"]) {
      assert.ok(called.includes(operation), `${operation} is not among ${called.join(", ")}`);
    }
    assert.ok(
      called.every((operation) => operation.startsWith("get ")),
      `the agent only reads: ${called.join(", ")}`,
    );
  });
});
