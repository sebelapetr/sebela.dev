// @ts-check

// Behaviour of the module checks of the import-boundaries rule, observed through the shared
// configuration: private module files, explicit module entries, the tooling provision and cycles
// between modules (backend module layout in docs/repository-structure.md).
//
// The committed fixture workspace in `fixtures/module-boundaries/` is a fictional miniature of the
// agreed phase 2 layout whose files all follow the rules: modules that use each other only through
// their `index.ts` entries, composition and CLI code using entries and package roots, colocated
// tests and private drivers, and a tooling configuration at a package root. Each negative case
// writes its own files into a disposable copy, under module names no other case uses, so that a
// cycle written by one case never reaches the modules of another.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { useFixtureWorkspace } from "./fixture-workspace.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "module-boundaries");
const { write, lint, assertAllowed, assertRejected } = useFixtureWorkspace("module-boundaries");

/**
 * Every committed source file of the fixture workspace, relative to its root.
 *
 * @returns {string[]}
 */
function committedSources() {
  return fs
    .readdirSync(FIXTURE, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(?:[cm]?[jt]s)$/u.test(file))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

const SERVICES = "packages/services/src/modules";

describe("module boundaries: the committed fixture follows the rules", () => {
  it("has the fixture files the positive cases rely on", () => {
    assert.deepEqual(committedSources(), [
      "apps/api/src/app.ts",
      "apps/api/src/cli/api-keys.ts",
      "apps/api/src/modules/profile/index.ts",
      "apps/api/src/modules/profile/routes.ts",
      "packages/db/drizzle.config.ts",
      "packages/db/src/index.ts",
      "packages/db/src/modules/profile/index.ts",
      "packages/db/src/modules/profile/schema.ts",
      "packages/services/src/index.ts",
      "packages/services/src/modules/api-keys/index.ts",
      "packages/services/src/modules/media/index.ts",
      "packages/services/src/modules/profile/experiences.test.ts",
      "packages/services/src/modules/profile/experiences.ts",
      "packages/services/src/modules/profile/index.ts",
      "packages/services/src/modules/storage/drivers/local.ts",
      "packages/services/src/modules/storage/index.ts",
    ]);
  });

  for (const file of committedSources()) {
    it(`lints ${file} with no errors at all`, async () => {
      const result = await lint(file);
      assert.deepEqual(
        result.messages.map((message) => `${String(message.ruleId)}: ${message.message}`),
        [],
      );
    });
  }
});

describe("module boundaries: private files of another module", () => {
  const importer = `${SERVICES}/media/upload.ts`;
  const driver = "../storage/drivers/local.js";
  const mentions = [`'${driver}'`, "packages/services/src/modules/storage", /private/u];

  /** @type {[form: string, code: string][]} */
  const forms = [
    ["a named import", `import { storeLocally } from "${driver}";\nexport { storeLocally };\n`],
    ["a default import", `import local from "${driver}";\nexport default local;\n`],
    ["a namespace import", `import * as local from "${driver}";\nexport { local };\n`],
    [
      "a type-only import",
      `import type { StoredFile } from "${driver}";\nexport type { StoredFile };\n`,
    ],
    ["a side-effect import", `import "${driver}";\n`],
    ["a named re-export", `export { storeLocally } from "${driver}";\n`],
    ["a type-only re-export", `export type { StoredFile } from "${driver}";\n`],
    ["a star re-export", `export * from "${driver}";\n`],
    ["a namespace re-export", `export * as local from "${driver}";\n`],
    ["a literal dynamic import", `export const load = () => import("${driver}");\n`],
    ["a template-literal dynamic import", `export const load = () => import(\`${driver}\`);\n`],
    ["an import type query", `export type Local = typeof import("${driver}");\n`],
  ];

  for (const [form, code] of forms) {
    it(`rejects ${form} of another module's private file`, async () => {
      await assertRejected(importer, code, { mentions });
    });
  }

  it("names the module entry to import instead", async () => {
    await assertRejected(importer, `import "${driver}";\n`, {
      mentions: ["packages/services/src/modules/storage/index"],
    });
  });

  it("rejects an index file below the module entry, which is still private", async () => {
    await assertRejected(importer, `import "../storage/drivers/index.js";\n`, {
      mentions: ["'../storage/drivers/index.js'", "packages/services/src/modules/storage"],
    });
  });

  it("rejects a private file in a JavaScript module", async () => {
    await assertRejected(`${SERVICES}/media/legacy.js`, `import "${driver}";\n`, { mentions });
  });

  it("rejects a private file reached through a subpath import of the package", async () => {
    await assertRejected(importer, `import "#modules/storage/drivers/local.js";\n`, {
      mentions: ["'#modules/storage/drivers/local.js'", "packages/services/src/modules/storage"],
    });
  });

  it("rejects a private file reached through a TypeScript path alias", async () => {
    await assertRejected(
      importer,
      `export * from "~services/modules/storage/drivers/local.js";\n`,
      {
        mentions: [
          "'~services/modules/storage/drivers/local.js'",
          "packages/services/src/modules/storage",
        ],
      },
    );
  });

  it("rejects composition code importing a private file of a module", async () => {
    await assertRejected("apps/api/src/server.ts", `import "./modules/profile/routes.js";\n`, {
      mentions: ["'./modules/profile/routes.js'", "apps/api/src/modules/profile"],
    });
  });

  it("rejects a package entry re-exporting a private file of a module", async () => {
    await assertRejected(
      "packages/services/src/seed.ts",
      `export { experienceTitles } from "./modules/profile/experiences.js";\n`,
      { mentions: ["'./modules/profile/experiences.js'", "packages/services/src/modules/profile"] },
    );
  });

  it("rejects a test outside the module importing one of its private files", async () => {
    await assertRejected(
      "packages/services/src/profile.test.ts",
      `import "./modules/profile/experiences.js";\n`,
      { mentions: ["'./modules/profile/experiences.js'", "packages/services/src/modules/profile"] },
    );
  });

  it("allows a module entry reached through a subpath import, an alias or a dynamic import", async () => {
    await assertAllowed(
      `${SERVICES}/media/entries.ts`,
      [
        `import "#modules/storage/index.js";`,
        `import "~services/modules/storage/index.js";`,
        `export const load = () => import("../storage/index.js");`,
        "",
      ].join("\n"),
    );
  });

  it("allows private files inside the same module, in nested folders too", async () => {
    await assertAllowed(
      `${SERVICES}/storage/drivers/bunny.ts`,
      `import "./local.js";\nimport "../index.js";\nexport type { StoredFile } from "../index.js";\n`,
    );
  });
});

describe("module boundaries: source access across packages", () => {
  it("rejects a relative path into another package's module", async () => {
    await assertRejected(
      "apps/api/src/server.ts",
      `import "../../../packages/services/src/modules/storage/drivers/local.js";\n`,
      { mentions: ["packages/services", "@sebela/services"] },
    );
  });

  it("rejects an alias into another package's module", async () => {
    await assertRejected(
      "apps/api/src/server.ts",
      `import "~services/modules/profile/index.js";\n`,
      { mentions: ["'~services/modules/profile/index.js'", "@sebela/services"] },
    );
  });

  it("rejects a root file reaching a private module file through a declared export", async () => {
    write(
      "packages/ledger/package.json",
      JSON.stringify({
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts", "./entries": "./src/modules/entries/store.ts" },
      }),
    );
    write("packages/ledger/src/modules/entries/store.ts", "export const store = 1;\n");
    await assertRejected("tools/ledger-report.ts", `import "@sebela/ledger/entries";\n`, {
      mentions: ["'@sebela/ledger/entries'", "packages/ledger/src/modules/entries", /private/u],
    });
  });

  it("rejects a declared package export that leads to a private module file", async () => {
    write(
      "packages/memory/package.json",
      JSON.stringify({
        private: true,
        type: "module",
        exports: {
          ".": "./src/index.ts",
          "./chunks": "./src/modules/chunks/split.ts",
          "./search": "./src/modules/search/index.ts",
        },
      }),
    );
    await assertRejected(`${SERVICES}/media/index-chunks.ts`, `import "@sebela/memory/chunks";\n`, {
      mentions: ["'@sebela/memory/chunks'", "packages/memory/src/modules/chunks", /private/u],
    });
    await assertAllowed(
      `${SERVICES}/media/index-search.ts`,
      `import "@sebela/memory";\nimport "@sebela/memory/search";\n`,
    );
  });
});

describe("module boundaries: tooling inside its own package", () => {
  const schema = "./src/modules/profile/schema.js";

  it("allows a tooling configuration at the package root to read a private module file", async () => {
    await assertAllowed("packages/db/vitest.config.mjs", `import "${schema}";\n`);
  });

  it("rejects runtime code outside the module reading the same private file", async () => {
    await assertRejected("packages/db/src/migrate.ts", `import "./modules/profile/schema.js";\n`, {
      mentions: ["'./modules/profile/schema.js'", "packages/db/src/modules/profile"],
    });
  });

  it("rejects a configuration file below the package root", async () => {
    await assertRejected("packages/db/tools/drizzle.config.ts", `import "../${schema}";\n`, {
      mentions: [`'../${schema}'`, "packages/db/src/modules/profile"],
    });
  });

  it("rejects runtime code importing a tooling configuration, which would forward its access", async () => {
    await assertRejected(
      "packages/db/src/schema-bridge.ts",
      `export * from "../drizzle.config.js";\n`,
      {
        mentions: ["'../drizzle.config.js'", "packages/db/drizzle.config", /tooling/u],
      },
    );
  });

  it("rejects another package importing a tooling configuration through a declared export", async () => {
    write(
      "packages/services/package.json",
      JSON.stringify({
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts", "./tool": "./vitest.config.ts" },
        imports: { "#modules/*": "./src/modules/*" },
      }),
    );
    write(
      "packages/services/vitest.config.ts",
      `import "./src/modules/storage/drivers/local.js";\n`,
    );
    await assertRejected("apps/api/src/uses-tool.ts", `import "@sebela/services/tool";\n`, {
      mentions: ["'@sebela/services/tool'", "packages/services/vitest.config", /tooling/u],
    });
  });

  it("does not let tooling of another package read a private module file", async () => {
    await assertRejected(
      "apps/api/drizzle.config.ts",
      `import "../../packages/db/src/modules/profile/schema.js";\n`,
      { mentions: ["packages/db", "@sebela/db"] },
    );
  });
});

describe("module boundaries: circular module dependencies", () => {
  /**
   * The expected fragment of a cycle diagnostic: the cycle as module folders of the member.
   *
   * @param {string[]} units
   */
  const cycle = (...units) => units.map((unit) => `src/modules/${unit}`).join(" -> ");

  it("rejects two modules importing each other's entries", async () => {
    write(`${SERVICES}/ring-b/index.ts`, `import "../ring-a/index.js";\n`);
    await assertRejected(`${SERVICES}/ring-a/index.ts`, `import "../ring-b/index.js";\n`, {
      mentions: [
        "'../ring-b/index.js'",
        /circular/u,
        "packages/services",
        cycle("ring-a", "ring-b", "ring-a"),
      ],
    });
  });

  it("rejects a longer cycle that returns through a private file of a third module", async () => {
    write(`${SERVICES}/tri-b/index.ts`, `export * from "../tri-c/index.js";\n`);
    write(`${SERVICES}/tri-c/index.ts`, `export { helper } from "./helper.js";\n`);
    write(`${SERVICES}/tri-c/helper.ts`, `import "../tri-a/index.js";\nexport const helper = 1;\n`);
    await assertRejected(`${SERVICES}/tri-a/index.ts`, `import "../tri-b/index.js";\n`, {
      mentions: [cycle("tri-a", "tri-b", "tri-c", "tri-a")],
    });
  });

  /** @type {[form: string, code: string][]} */
  const edges = [
    [
      "a type-only import",
      `import type { Value } from "../KIND-b/index.js";\nexport type { Value };\n`,
    ],
    ["a re-export", `export * from "../KIND-b/index.js";\n`],
    ["a literal dynamic import", `export const load = () => import("../KIND-b/index.js");\n`],
    ["an import type query", `export type Other = typeof import("../KIND-b/index.js");\n`],
  ];
  for (const [index, [form, code]] of edges.entries()) {
    it(`rejects a cycle closed by ${form}`, async () => {
      const kind = `edge${String(index)}`;
      write(
        `${SERVICES}/${kind}-b/index.ts`,
        `import type { Own } from "../${kind}-a/index.js";\nexport type Value = Own;\n`,
      );
      await assertRejected(
        `${SERVICES}/${kind}-a/index.ts`,
        `${code.replaceAll("KIND", kind)}export type Own = string;\n`,
        { mentions: [/circular/u, cycle(`${kind}-a`, `${kind}-b`, `${kind}-a`)] },
      );
    });
  }

  it("rejects a cycle whose other half uses a subpath import", async () => {
    write(`${SERVICES}/hash-b/index.ts`, `import "#modules/hash-a/index.js";\n`);
    await assertRejected(`${SERVICES}/hash-a/index.ts`, `import "../hash-b/index.js";\n`, {
      mentions: [cycle("hash-a", "hash-b", "hash-a")],
    });
  });

  it("rejects a cycle whose other half uses a TypeScript path alias", async () => {
    write(`${SERVICES}/alias-b/index.ts`, `import "~services/modules/alias-a/index.js";\n`);
    await assertRejected(`${SERVICES}/alias-a/index.ts`, `import "../alias-b/index.js";\n`, {
      mentions: [cycle("alias-a", "alias-b", "alias-a")],
    });
  });

  it("rejects a cycle through composition code outside the modules", async () => {
    write("packages/services/src/registry.ts", `export * from "./modules/loop/index.js";\n`);
    await assertRejected(`${SERVICES}/loop/index.ts`, `import "../../registry.js";\n`, {
      mentions: [/circular/u, "src/modules/loop -> src/registry -> src/modules/loop"],
    });
  });

  it("rejects a cycle through the package's own name", async () => {
    write(
      "packages/llm-tools/package.json",
      JSON.stringify({ private: true, type: "module", exports: { ".": "./src/index.ts" } }),
    );
    write("packages/llm-tools/src/index.ts", `export * from "./modules/prompts/index.js";\n`);
    await assertRejected(
      "packages/llm-tools/src/modules/prompts/index.ts",
      `import "@sebela/llm-tools";\n`,
      {
        mentions: [
          "'@sebela/llm-tools'",
          "packages/llm-tools",
          "src/modules/prompts -> src/index -> src/modules/prompts",
        ],
      },
    );
  });

  it("rejects a cycle between JavaScript modules", async () => {
    write(`${SERVICES}/js-b/index.js`, `export * from "../js-a/index.js";\n`);
    await assertRejected(`${SERVICES}/js-a/index.js`, `export * from "../js-b/index.js";\n`, {
      mentions: [cycle("js-a", "js-b", "js-a")],
    });
  });

  it("reports only the imports that close a cycle", async () => {
    write(`${SERVICES}/pair-y/index.ts`, `import "../pair-z/index.js";\n`);
    write(`${SERVICES}/pair-z/index.ts`, `import "../pair-y/index.js";\n`);
    await assertAllowed(`${SERVICES}/pair-x/index.ts`, `import "../pair-y/index.js";\n`);
  });

  it("allows imports inside one module that refer to each other", async () => {
    write(`${SERVICES}/self/second.ts`, `import "./first.js";\nexport const second = 2;\n`);
    await assertAllowed(
      `${SERVICES}/self/first.ts`,
      `import "./second.js";\nimport "./index.js";\nexport const first = 1;\n`,
    );
  });
});
