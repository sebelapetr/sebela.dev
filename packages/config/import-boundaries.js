// @ts-check

import path from "node:path";

import {
  SCOPE,
  exportFiles,
  exportsMap,
  findWorkspaceRoot,
  importTargets,
  isRecord,
  matchSubpath,
  memberContaining,
  memberNamed,
} from "./import-resolution.js";
import { createModuleGraph, isModuleEntry, isToolingConfig, moduleOf } from "./module-graph.js";

/**
 * The `sebela/import-boundaries` rule: the dependency table and the API trust boundary from
 * `docs/repository-structure.md`, checked on every module specifier of a file.
 *
 * - The workspace root is the nearest ancestor folder of the linted file that contains
 *   `pnpm-workspace.yaml`. A file under `apps/<name>/` or `packages/<name>/` belongs to that
 *   member; any other file of the workspace (the harness, root configuration) is a root file.
 * - A member imports another workspace member only by its package name `@sebela/<name>`, and only
 *   if its row in the dependency table allows it. Nothing imports an app. A member without a row
 *   imports no workspace package until its row is added here and in the documentation. A few
 *   packages are allowed in a member's test files only (`TEST_DEPENDENCIES`).
 * - Every `@sebela/*` specifier must name a declared entry point: a subpath listed in `exports` of
 *   the target's `package.json`, or only the package root when the target declares no `exports`
 *   or does not exist yet. Subpath patterns (`./x/*`) and `null` exclusions are honoured.
 * - A relative, absolute or `file:` path may not leave the importing member, reach into another
 *   member, or go through `node_modules/@sebela/*`; root files may not reach into a member.
 * - Aliases are checked where they lead: `#` subpath imports through the `imports` map of the
 *   importer's `package.json`, and, in type-checked TypeScript files, any other bare specifier
 *   that the TypeScript program resolves to a file of the workspace (for example `paths`).
 * - Within a member, the backend module layout holds (see `module-graph.js`): a file outside a
 *   module `src/modules/<name>/` imports only its entry `index.<ext>`, never another of its files;
 *   the one exception is a tooling configuration `*.config.<ext>` directly in the member folder,
 *   which no other file of the member imports. A declared export of a package that leads to a
 *   private module file is rejected where it is imported.
 * - No import closes a cycle between the modules of a member: modules depend on each other in one
 *   direction only, also through files outside the modules. Cycles across members cannot arise,
 *   because the dependency table is acyclic.
 *
 * Checked forms: static imports and re-exports (including type-only ones), dynamic `import()`,
 * `require()`, TypeScript `import x = require()` and `typeof import()`. Only specifiers written as
 * string literals (or template literals without substitutions) can be checked.
 */

/**
 * The dependency table of `docs/repository-structure.md`: the packages each member may import,
 * besides itself. Keep the two in step.
 *
 * @type {ReadonlyMap<string, readonly string[]>}
 */
const DEPENDENCIES = new Map([
  ["apps/web", ["api-client", "contracts", "ui", "config"]],
  ["apps/mcp-admin", ["api-client", "contracts", "config"]],
  ["apps/llm-agent", []],
  ["apps/api", ["services", "contracts", "config"]],
  ["packages/services", ["db", "contracts", "memory", "config"]],
  ["packages/db", ["config"]],
  ["packages/contracts", ["config"]],
  ["packages/api-client", ["config"]],
  ["packages/config", []],
]);

/**
 * Packages a member may import only in its test files (`*.test.<ext>`), besides its row above:
 * the API's consumer contract tests call the API through its generated client.
 *
 * @type {ReadonlyMap<string, readonly string[]>}
 */
const TEST_DEPENDENCIES = new Map([["apps/api", ["api-client"]]]);

/** A test file: `<name>.test.<ext>`. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** @typedef {import("./import-resolution.js").Member} Member */
/** @typedef {import("./import-resolution.js").Target} Target */

/**
 * @param {readonly string[]} names
 */
function packageList(names) {
  return names.length === 0
    ? "nothing from this repository"
    : names.map((name) => `${SCOPE}${name}`).join(", ");
}

/**
 * The string value of a literal or substitution-free template literal node, if any.
 *
 * @param {unknown} node
 * @returns {string | undefined}
 */
function staticString(node) {
  if (!isRecord(node)) return undefined;
  if (node["type"] === "Literal" && typeof node["value"] === "string") return node["value"];
  const expressions = node["expressions"];
  const quasis = node["quasis"];
  if (
    node["type"] === "TemplateLiteral" &&
    Array.isArray(expressions) &&
    expressions.length === 0 &&
    Array.isArray(quasis)
  ) {
    const [quasi] = /** @type {unknown[]} */ (quasis);
    const value = isRecord(quasi) ? quasi["value"] : undefined;
    const cooked = isRecord(value) ? value["cooked"] : undefined;
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
const importBoundaries = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce the dependency table and the API trust boundary of docs/repository-structure.md.",
    },
    schema: [],
    messages: {
      testOnlyPackage:
        "'{{specifier}}' imports {{target}}, which {{importer}} may import only in its tests (*.test.<ext>). Outside them {{importer}} may import {{allowed}} (dependency table in docs/repository-structure.md).",
      forbiddenPackage:
        "'{{specifier}}' imports {{target}}, which {{importer}} may not import. {{importer}} may import {{allowed}} (dependency table in docs/repository-structure.md).",
      appImport:
        "'{{specifier}}' imports the app {{targetDir}} ({{target}}). Apps are deployables and are never imported; share code through a package allowed by the dependency table in docs/repository-structure.md.",
      unlistedImporter:
        "'{{specifier}}' imports {{target}}, but {{importer}} has no row in the dependency table in docs/repository-structure.md. Add its row there and to the import-boundaries rule of @sebela/config first.",
      undeclaredSubpath:
        "'{{specifier}}' is not a declared export of {{target}}. Import one of its declared entry points: {{entries}}.",
      pathIntoMember:
        "'{{specifier}}' reaches into {{targetDir}} by path or alias, bypassing the public entry of {{target}}. Import it by its package name through a declared entry point instead.",
      pathOutsideMember:
        "'{{specifier}}' leaves {{importer}} by path or alias. Code outside a package is imported only by package name through a declared entry point.",
      privateModuleFile:
        "'{{specifier}}' imports a private file of the module {{module}}. Code outside a module uses only its entry {{module}}/index (backend module layout in docs/repository-structure.md).",
      toolingConfigImport:
        "'{{specifier}}' imports the tooling configuration {{config}}. Only tooling configurations may read private module files, so no other code imports them; import the module entry instead.",
      moduleCycle:
        "'{{specifier}}' closes a circular dependency between modules of {{member}}: {{cycle}}. Modules depend on each other in one direction only; move the shared part into a module both can use, or invert the dependency.",
    },
  },

  create(context) {
    const file = context.physicalFilename;
    if (!path.isAbsolute(file)) return {};
    const found = findWorkspaceRoot(path.dirname(file));
    if (found === undefined) return {};
    /** @type {string} */
    const root = found;
    const importer = memberContaining(file, root);
    const manifestDir = importer === undefined ? root : path.join(root, importer.dir);
    const program = /** @type {{ program?: import("typescript").Program | null } | undefined} */ (
      context.sourceCode.parserServices
    )?.program;
    const resolution = {
      file,
      manifestDir,
      compilerOptions: program?.getCompilerOptions(),
      currentDirectory: program?.getCurrentDirectory(),
    };
    const importerIsTooling = isToolingConfig(file, root);
    const importerIsTest = TEST_FILE.test(path.basename(file));
    /** @type {ReturnType<typeof createModuleGraph> | undefined} */
    let graph;

    /**
     * Checks the importer's row of the dependency table for `target`. Reports and returns false
     * when the import is not allowed.
     *
     * @param {import("eslint").Rule.Node} node
     * @param {string} specifier
     * @param {Member} target
     */
    function checkTable(node, specifier, target) {
      const data = { specifier, target: `${SCOPE}${target.name}`, targetDir: target.dir };
      if (target.dir.startsWith("apps/")) {
        context.report({ node, messageId: "appImport", data });
        return false;
      }
      if (importer === undefined) return true;
      const allowed = DEPENDENCIES.get(importer.dir);
      if (allowed === undefined) {
        context.report({
          node,
          messageId: "unlistedImporter",
          data: { ...data, importer: importer.dir },
        });
        return false;
      }
      if (!allowed.includes(target.name)) {
        if (TEST_DEPENDENCIES.get(importer.dir)?.includes(target.name)) {
          if (importerIsTest) return true;
          context.report({
            node,
            messageId: "testOnlyPackage",
            data: { ...data, importer: importer.dir, allowed: packageList(allowed) },
          });
          return false;
        }
        context.report({
          node,
          messageId: "forbiddenPackage",
          data: { ...data, importer: importer.dir, allowed: packageList(allowed) },
        });
        return false;
      }
      return true;
    }

    /**
     * Checks one target of `specifier`. Reports and returns false when it is not allowed.
     *
     * @param {import("eslint").Rule.Node} node
     * @param {string} specifier
     * @param {Target} target
     */
    function checkTarget(node, specifier, target) {
      if (target.kind === "package") {
        const member = memberNamed(target.name, root);
        if (importer?.dir !== member.dir && !checkTable(node, specifier, member)) return false;
        const entries = exportsMap(member, root);
        const match = matchSubpath(entries, `.${target.subpath}`);
        if (match !== undefined && match.value !== null) return true;
        const declared = Object.entries(entries)
          .filter(([, value]) => value !== null)
          .map(([key]) => `${SCOPE}${target.name}${key.slice(1)}`);
        context.report({
          node,
          messageId: "undeclaredSubpath",
          data: {
            specifier,
            target: `${SCOPE}${target.name}`,
            entries: declared.length === 0 ? "none" : declared.join(", "),
          },
        });
        return false;
      }

      const member = memberContaining(target.file, root);
      if (member !== undefined && (member.dir !== importer?.dir || member.installed === true)) {
        if (member.dir !== importer?.dir && !checkTable(node, specifier, member)) return false;
        context.report({
          node,
          messageId: "pathIntoMember",
          data: { specifier, target: `${SCOPE}${member.name}`, targetDir: member.dir },
        });
        return false;
      }
      if (importer !== undefined && member === undefined) {
        context.report({
          node,
          messageId: "pathOutsideMember",
          data: { specifier, importer: importer.dir },
        });
        return false;
      }
      return true;
    }

    /**
     * Checks the backend module layout for one file `target` that `specifier` loads, once the
     * dependency table and the package boundaries allow it. Reports and returns false when it is
     * not allowed.
     *
     * @param {import("eslint").Rule.Node} node
     * @param {string} specifier
     * @param {string} target
     */
    function checkModuleTarget(node, specifier, target) {
      const module = moduleOf(target, root);
      const sameMember = importer !== undefined && module?.member.dir === importer.dir;
      if (
        module !== undefined &&
        !isModuleEntry(target, module) &&
        path.relative(module.dir, file).startsWith("..") &&
        !(importerIsTooling && sameMember)
      ) {
        context.report({
          node,
          messageId: "privateModuleFile",
          data: { specifier, module: module.label },
        });
        return false;
      }

      const member = memberContaining(target, root);
      const inImporter =
        importer !== undefined && member?.dir === importer.dir && member.installed !== true;
      // A tooling configuration may be imported only by another tooling configuration of its own
      // member; reached any other way, even through a declared export, it would forward its
      // access to the member's private module files.
      if (isToolingConfig(target, root) && !(importerIsTooling && inImporter)) {
        const config = path.relative(root, target).split(path.sep).join("/");
        context.report({
          node,
          messageId: "toolingConfigImport",
          data: { specifier, config: config.replace(/\.(?:[cm]?[jt]sx?)$/u, "") },
        });
        return false;
      }

      if (!inImporter) return true;
      graph ??= createModuleGraph({ root, member: importer, importer: file, ...resolution });
      const cycle = graph.cycleThrough(target);
      if (cycle !== undefined) {
        context.report({
          node,
          messageId: "moduleCycle",
          data: { specifier, member: importer.dir, cycle: cycle.join(" -> ") },
        });
        return false;
      }
      return true;
    }

    /**
     * The files a target loads: the file of a path, or every file a declared export leads to.
     *
     * @param {Target} target
     * @returns {string[]}
     */
    function filesOf(target) {
      if (target.kind === "path") return [target.file];
      return exportFiles(memberNamed(target.name, root), target.subpath, root);
    }

    /**
     * Checks the module specifier held by `source`, reporting at most one violation.
     *
     * @param {unknown} source
     */
    function check(source) {
      const specifier = staticString(source);
      if (specifier === undefined) return;
      const node = /** @type {import("eslint").Rule.Node} */ (source);
      const targets = importTargets(specifier, resolution);
      for (const target of targets) {
        if (!checkTarget(node, specifier, target)) return;
      }
      for (const target of targets) {
        for (const loaded of filesOf(target)) {
          if (!checkModuleTarget(node, specifier, loaded)) return;
        }
      }
    }

    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node.source);
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
      ImportExpression(node) {
        check(node.source);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          check(node.arguments[0]);
        }
      },
      /** @param {{ moduleReference?: { type?: string, expression?: unknown } }} node */
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference?.type === "TSExternalModuleReference") {
          check(node.moduleReference.expression);
        }
      },
      /** @param {{ source?: unknown, argument?: { literal?: unknown } }} node */
      TSImportType(node) {
        check(node.source ?? node.argument?.literal);
      },
    };
  },
};

export default importBoundaries;
