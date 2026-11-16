// @ts-check

// Behaviour of the import-boundaries rule for the dependency table and the API trust boundary,
// observed through the shared configuration: every case lints a file of the fictional workspace in
// `fixtures/import-boundaries/` with `createConfig` and checks what ESLint reports. The fixture
// holds only the workspace marker, `package.json` files declaring exports and imports, a tsconfig
// with `paths` aliases, and an allowed and a forbidden source file. The module checks are tested in
// `module-boundaries.test.js`.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { useFixtureWorkspace } from "./fixture-workspace.js";

const {
  root: ROOT,
  lint,
  violations,
  assertAllowed,
  assertRejected,
} = useFixtureWorkspace("import-boundaries");

describe("import boundaries: fixture files on disk", () => {
  it("passes the allowed fixture with no lint errors at all", async () => {
    const result = await lint("apps/web/src/allowed.ts");
    assert.deepEqual(
      result.messages.map((message) => `${String(message.ruleId)}: ${message.message}`),
      [],
    );
  });

  it("rejects every forbidden import of the forbidden fixture", async () => {
    const found = await violations("apps/web/src/forbidden.ts");
    assert.deepEqual(
      found.map((message) => message.line),
      [2, 3, 4],
    );
    assert.match(found[0]?.message ?? "", /'@sebela\/db'.*apps\/web/);
    assert.match(found[1]?.message ?? "", /'@sebela\/services'.*apps\/web/);
    assert.match(
      found[2]?.message ?? "",
      /'\.\.\/\.\.\/\.\.\/packages\/db\/src\/schema\.js'.*apps\/web/,
    );
  });
});

describe("import boundaries: the dependency table", () => {
  /** @type {[importer: string, allowed: string[], forbidden: string[]][]} */
  const table = [
    [
      "apps/web/src/page.ts",
      ["@sebela/api-client", "@sebela/contracts", "@sebela/ui"],
      ["@sebela/db", "@sebela/services", "@sebela/memory"],
    ],
    [
      "apps/mcp-admin/src/server.ts",
      ["@sebela/api-client", "@sebela/contracts"],
      ["@sebela/db", "@sebela/services", "@sebela/memory", "@sebela/ui"],
    ],
    [
      "apps/api/src/app.ts",
      ["@sebela/services", "@sebela/contracts", "@sebela/api-client"],
      ["@sebela/db", "@sebela/memory", "@sebela/ui"],
    ],
    [
      "packages/api-client/src/index.ts",
      [],
      ["@sebela/contracts", "@sebela/services", "@sebela/db", "@sebela/ui"],
    ],
    [
      "packages/services/src/index.ts",
      ["@sebela/db", "@sebela/contracts", "@sebela/memory"],
      ["@sebela/api-client", "@sebela/ui"],
    ],
    [
      "packages/db/src/index.ts",
      [],
      ["@sebela/contracts", "@sebela/services", "@sebela/memory", "@sebela/api-client"],
    ],
    ["packages/contracts/src/index.ts", [], ["@sebela/db", "@sebela/services", "@sebela/ui"]],
    ["apps/llm-agent/tools/generate.mjs", [], ["@sebela/contracts", "@sebela/db"]],
  ];

  for (const [importer, allowed, forbidden] of table) {
    const member = importer.split("/").slice(0, 2).join("/");

    for (const target of allowed) {
      it(`allows ${member} to import ${target}`, async () => {
        await assertAllowed(importer, `export * from "${target}";\n`);
      });
    }

    for (const target of forbidden) {
      it(`rejects ${member} importing ${target}`, async () => {
        await assertRejected(importer, `export * from "${target}";\n`, {
          mentions: [`'${target}'`, member, "docs/repository-structure.md"],
        });
      });
    }
  }

  it("names what the importer may import instead", async () => {
    await assertRejected("apps/web/src/page.ts", `import "@sebela/db";\n`, {
      mentions: ["@sebela/api-client", "@sebela/contracts", "@sebela/ui", "@sebela/config"],
    });
  });

  it("allows the shared configuration through its declared entry", async () => {
    for (const importer of [
      "apps/web/eslint.config.js",
      "apps/api/eslint.config.js",
      "apps/mcp-admin/eslint.config.js",
      "packages/services/eslint.config.js",
      "packages/db/eslint.config.js",
      "packages/contracts/eslint.config.js",
      "packages/api-client/eslint.config.js",
    ]) {
      await assertAllowed(importer, `export { createConfig } from "@sebela/config/eslint";\n`);
    }
  });

  it("does not let the configuration package import any other workspace package", async () => {
    await assertRejected("packages/config/eslint.js", `import "@sebela/contracts";\n`, {
      mentions: ["'@sebela/contracts'", "packages/config"],
    });
  });

  it("rejects a forbidden package even through one of its subpaths", async () => {
    await assertRejected("apps/web/src/page.ts", `import "@sebela/db/schema";\n`, {
      mentions: ["'@sebela/db/schema'", "apps/web", "@sebela/db"],
    });
  });

  it("rejects a package that is not in the dependency table", async () => {
    await assertRejected("apps/api/src/app.ts", `import "@sebela/payments";\n`, {
      mentions: ["'@sebela/payments'", "apps/api"],
    });
  });

  it("rejects every import of a workspace package from a member without a row", async () => {
    await assertRejected("packages/ui/src/button.tsx", `import "@sebela/contracts";\n`, {
      mentions: ["'@sebela/contracts'", "packages/ui", /no row in the dependency table/],
    });
  });

  it("lets a package import itself through its own entry", async () => {
    await assertAllowed("packages/contracts/src/errors.ts", `export * from "@sebela/contracts";\n`);
  });

  it("ignores third-party and Node.js built-in modules", async () => {
    await assertAllowed(
      "apps/web/src/page.ts",
      `import "react";\nimport "node:fs";\nimport "@other/db";\nimport "sebela-db";\n`,
    );
  });
});

describe("import boundaries: imports between apps", () => {
  /** @type {[importer: string, target: string][]} */
  const cases = [
    ["apps/web/src/page.ts", "@sebela/api"],
    ["apps/api/src/app.ts", "@sebela/web"],
    ["apps/mcp-admin/src/server.ts", "@sebela/api"],
    ["apps/web/src/page.ts", "@sebela/mcp-admin"],
    ["packages/services/src/index.ts", "@sebela/api"],
  ];
  for (const [importer, target] of cases) {
    it(`rejects ${importer} importing the app ${target}`, async () => {
      await assertRejected(importer, `import "${target}";\n`, {
        mentions: [`'${target}'`, /apps? .*never imported/],
      });
    });
  }

  it("rejects a relative path into another app", async () => {
    await assertRejected("apps/web/src/page.ts", `import "../../api/src/app.js";\n`, {
      mentions: ["'../../api/src/app.js'", "apps/api"],
    });
  });
});

describe("import boundaries: supported import forms", () => {
  const file = "apps/web/src/page.ts";

  /** @type {[form: string, code: string, line?: number][]} */
  const forms = [
    ["a default import", `import db from "@sebela/db";\nexport default db;\n`],
    ["a named import", `import { users } from "@sebela/db";\nexport { users };\n`],
    ["a namespace import", `import * as db from "@sebela/db";\nexport { db };\n`],
    ["a type-only import", `import type { User } from "@sebela/db";\nexport type { User };\n`],
    ["a side-effect import", `import "@sebela/db";\n`],
    ["a named re-export", `export { users } from "@sebela/db";\n`],
    ["a type-only re-export", `export type { User } from "@sebela/db";\n`],
    ["a star re-export", `export * from "@sebela/db";\n`],
    ["a namespace re-export", `export * as db from "@sebela/db";\n`],
    ["a dynamic import", `export const load = () => import("@sebela/db");\n`],
    [
      "a dynamic import with a template literal",
      "export const load = () => import(`@sebela/db`);\n",
    ],
    ["an import type query", `export type Db = typeof import("@sebela/db");\n`],
    ["a TypeScript import-equals require", `import db = require("@sebela/db");\nexport { db };\n`],
    ["an import on a later line", `import "react";\n\nimport "@sebela/db";\n`, 3],
  ];

  for (const [form, code, line] of forms) {
    it(`rejects ${form}`, async () => {
      await assertRejected(file, code, {
        ...(line === undefined ? {} : { line }),
        mentions: ["'@sebela/db'", "apps/web"],
      });
    });
  }

  it("rejects a CommonJS require", async () => {
    await assertRejected("apps/web/scripts/seed.cjs", `const db = require("@sebela/db");\n`, {
      mentions: ["'@sebela/db'", "apps/web"],
    });
  });

  for (const extension of ["js", "mjs", "cjs", "ts", "tsx", "mts", "cts"]) {
    it(`checks .${extension} source files`, async () => {
      await assertRejected(
        `apps/web/src/${extension}-source.${extension}`,
        `import "@sebela/services";\n`,
        {
          mentions: ["'@sebela/services'"],
        },
      );
    });
  }

  it("reports each forbidden import of a file separately", async () => {
    const found = await violations(
      file,
      `import "@sebela/db";\nimport "@sebela/contracts";\nexport * from "@sebela/services";\n`,
    );
    assert.deepEqual(
      found.map((message) => message.line),
      [1, 3],
    );
  });
});

describe("import boundaries: bypass-prone paths", () => {
  it("rejects a relative path into a forbidden package", async () => {
    await assertRejected("apps/web/src/page.ts", `import "../../../packages/db/src/index.js";\n`, {
      mentions: ["'../../../packages/db/src/index.js'", "apps/web", "@sebela/db"],
    });
  });

  it("rejects a relative path into an allowed package, which bypasses its public entry", async () => {
    await assertRejected(
      "apps/api/src/app.ts",
      `export * from "../../../packages/services/src/modules/profile/index.js";\n`,
      {
        mentions: [
          "'../../../packages/services/src/modules/profile/index.js'",
          "packages/services",
          "@sebela/services",
        ],
      },
    );
  });

  it("rejects an absolute path into another package", async () => {
    const target = path.join(ROOT, "packages", "db", "src", "index.js");
    await assertRejected("apps/web/src/page.ts", `import ${JSON.stringify(target)};\n`, {
      mentions: ["apps/web", "@sebela/db"],
    });
  });

  it("rejects a file URL into another package", async () => {
    const target = pathToFileURL(path.join(ROOT, "packages", "db", "src", "index.js")).href;
    await assertRejected("apps/web/src/page.ts", `import "${target}";\n`, {
      mentions: ["apps/web", "@sebela/db"],
    });
  });

  it("rejects a path through the installed package in node_modules", async () => {
    await assertRejected(
      "apps/api/src/app.ts",
      `import "../node_modules/@sebela/db/src/index.js";\n`,
      { mentions: ["'../node_modules/@sebela/db/src/index.js'", "apps/api", "@sebela/db"] },
    );
  });

  it("rejects a path through node_modules into an allowed package", async () => {
    await assertRejected(
      "apps/api/src/app.ts",
      `import "../node_modules/@sebela/services/src/internal.js";\n`,
      { mentions: ["'../node_modules/@sebela/services/src/internal.js'", "@sebela/services"] },
    );
  });

  it("leaves paths into third-party packages installed in the member alone", async () => {
    await assertAllowed("apps/api/src/app.ts", `import "../node_modules/hono/dist/index.js";\n`);
  });

  it("rejects a relative path that leaves the package for the repository root", async () => {
    await assertRejected("packages/db/src/index.ts", `import "../../../scripts/tool.js";\n`, {
      mentions: ["'../../../scripts/tool.js'", "packages/db"],
    });
  });

  it("allows relative paths that stay inside the package", async () => {
    await assertAllowed(
      "apps/web/src/routes/page.ts",
      `import "./helper.js";\nimport "../lib/format.js";\nimport "../../web/src/lib/format.js";\n`,
    );
  });

  it("rejects an undeclared subpath of an allowed package", async () => {
    await assertRejected(
      "apps/api/src/app.ts",
      `import "@sebela/services/src/modules/profile/index.js";\n`,
      {
        mentions: [
          "'@sebela/services/src/modules/profile/index.js'",
          /not a declared export/,
          "@sebela/services",
        ],
      },
    );
  });

  it("allows the declared exports of an allowed package", async () => {
    await assertAllowed(
      "apps/web/src/page.ts",
      `import "@sebela/contracts";\nimport "@sebela/contracts/errors";\nimport "@sebela/contracts/schemas/profile";\n`,
    );
  });

  for (const specifier of [
    "@sebela/contracts/src/errors.ts",
    "@sebela/contracts/package.json",
    "@sebela/contracts/schemas/internal/keys",
    "@sebela/contracts/errors/details",
  ]) {
    it(`rejects ${specifier}, which the package does not export`, async () => {
      await assertRejected("apps/web/src/page.ts", `import "${specifier}";\n`, {
        mentions: [`'${specifier}'`, /not a declared export/, "@sebela/contracts"],
      });
    });
  }

  it("rejects the package root of a package that exports only subpaths", async () => {
    await assertRejected("apps/web/eslint.config.js", `import "@sebela/config";\n`, {
      mentions: ["'@sebela/config'", /not a declared export/, "@sebela/config/eslint"],
    });
  });
});

describe("import boundaries: aliases", () => {
  // `apps/web/package.json` maps `#db`, `#contracts` and `#internal/*`; the workspace tsconfig maps
  // `~db/*` and `~contracts` onto package sources and `~web/*` onto the web app's own sources.

  it("rejects a subpath import that maps to a forbidden package", async () => {
    await assertRejected("apps/web/src/page.ts", `import "#db";\n`, {
      mentions: ["'#db'", "apps/web", "@sebela/db"],
    });
  });

  it("allows a subpath import that maps to an allowed package entry", async () => {
    await assertAllowed("apps/web/src/page.ts", `import "#contracts";\n`);
  });

  it("allows a subpath import that maps inside the package", async () => {
    await assertAllowed("apps/web/src/page.ts", `import "#internal/format";\n`);
  });

  it("rejects a TypeScript path alias into a forbidden package", async () => {
    await lint("packages/db/src/schema.ts", "export const users = 1;\n");
    await assertRejected("apps/web/src/page.ts", `export { users } from "~db/schema";\n`, {
      mentions: ["'~db/schema'", "apps/web", "@sebela/db"],
    });
  });

  it("rejects a TypeScript path alias that bypasses an allowed package's entry", async () => {
    await lint("packages/contracts/src/index.ts", "export const version = 1;\n");
    await assertRejected("apps/web/src/page.ts", `export { version } from "~contracts";\n`, {
      mentions: ["'~contracts'", "packages/contracts", "@sebela/contracts"],
    });
  });

  it("allows a TypeScript path alias inside the importing package", async () => {
    await lint("apps/web/src/lib/format.ts", "export const format = 1;\n");
    await assertAllowed("apps/web/src/page.ts", `export { format } from "~web/lib/format";\n`);
  });
});

describe("import boundaries: files outside apps and packages", () => {
  it("allows a root file to use a declared package entry", async () => {
    await assertAllowed(
      "eslint.config.js",
      `export { createConfig } from "@sebela/config/eslint";\n`,
    );
  });

  it("rejects a root file reaching into a package by path", async () => {
    await assertRejected("eslint.config.js", `import "./packages/config/eslint.js";\n`, {
      mentions: ["'./packages/config/eslint.js'", "@sebela/config"],
    });
  });

  it("rejects a root file importing an undeclared subpath", async () => {
    await assertRejected("scripts/tool.mjs", `import "@sebela/contracts/src/index.ts";\n`, {
      mentions: ["'@sebela/contracts/src/index.ts'", /not a declared export/],
    });
  });
});
