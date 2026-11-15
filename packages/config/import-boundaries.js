// @ts-check

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The `sebela/import-boundaries` rule: the dependency table and the API trust boundary from
 * `docs/repository-structure.md`, checked on every module specifier of a file.
 *
 * - The workspace root is the nearest ancestor folder of the linted file that contains
 *   `pnpm-workspace.yaml`. A file under `apps/<name>/` or `packages/<name>/` belongs to that
 *   member; any other file of the workspace (the harness, root configuration) is a root file.
 * - A member imports another workspace member only by its package name `@sebela/<name>`, and only
 *   if its row in the dependency table allows it. Nothing imports an app. A member without a row
 *   imports no workspace package until its row is added here and in the documentation.
 * - Every `@sebela/*` specifier must name a declared entry point: a subpath listed in `exports` of
 *   the target's `package.json`, or only the package root when the target declares no `exports`
 *   or does not exist yet. Subpath patterns (`./x/*`) and `null` exclusions are honoured.
 * - A relative, absolute or `file:` path may not leave the importing member, reach into another
 *   member, or go through `node_modules/@sebela/*`; root files may not reach into a member.
 *
 * Checked forms: static imports and re-exports (including type-only ones), dynamic `import()`,
 * `require()`, TypeScript `import x = require()` and `typeof import()`. Only specifiers written as
 * string literals (or template literals without substitutions) can be checked.
 */

const SCOPE = "@sebela/";
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** The apps of the repository layout. Apps are deployables and are never imported. */
const APPS = new Set(["web", "api", "mcp-admin", "llm-agent"]);

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
  ["packages/config", []],
]);

/**
 * @typedef {object} Member
 * @property {string} dir The member folder relative to the workspace root, e.g. `apps/web`.
 * @property {string} name The folder name, which is also the package name after `@sebela/`.
 * @property {boolean} [installed] Reached through `node_modules/@sebela/<name>`.
 */

/**
 * A resolved specifier: either a workspace package by name, or a file path.
 *
 * @typedef {{ kind: "package", name: string, subpath: string } | { kind: "path", file: string }} Target
 */

/**
 * The nearest ancestor of `dir` that contains the workspace marker, or `undefined`.
 *
 * @param {string} dir
 * @returns {string | undefined}
 */
function findWorkspaceRoot(dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, WORKSPACE_MARKER))) return current;
    if (path.dirname(current) === current) return undefined;
  }
}

/**
 * @param {string} name
 * @param {string} root
 * @returns {Member}
 */
function memberNamed(name, root) {
  const kind = APPS.has(name) || fs.existsSync(path.join(root, "apps", name)) ? "apps" : "packages";
  return { dir: `${kind}/${name}`, name };
}

/**
 * The workspace member that contains `file`, or `undefined` for a root file or a file outside the
 * workspace. A path through `node_modules/@sebela/<name>` belongs to the member `<name>`.
 *
 * @param {string} file
 * @param {string} root
 * @returns {Member | undefined}
 */
function memberContaining(file, root) {
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  const segments = relative.split(path.sep);

  const installed = segments.lastIndexOf("node_modules");
  if (installed !== -1 && `${segments[installed + 1] ?? ""}/` === SCOPE) {
    const name = segments[installed + 2];
    if (name) return { ...memberNamed(name, root), installed: true };
  }

  const [kind, name] = segments;
  if ((kind === "apps" || kind === "packages") && name) return { dir: `${kind}/${name}`, name };
  return undefined;
}

/**
 * @param {string} specifier
 * @param {string} fromDir
 * @returns {Target | undefined}
 */
function resolveSpecifier(specifier, fromDir) {
  if (specifier.startsWith(SCOPE)) {
    const rest = specifier.slice(SCOPE.length);
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    return name
      ? { kind: "package", name, subpath: slash === -1 ? "" : rest.slice(slash) }
      : undefined;
  }

  if (specifier.startsWith("file:")) {
    try {
      return { kind: "path", file: fileURLToPath(specifier) };
    } catch {
      return undefined;
    }
  }

  const withoutQuery = specifier.replace(/[?#].*$/u, "");
  if (path.isAbsolute(withoutQuery)) return { kind: "path", file: path.normalize(withoutQuery) };
  if (/^\.\.?(?:\/|$)/u.test(withoutQuery)) {
    return { kind: "path", file: path.resolve(fromDir, withoutQuery) };
  }
  return undefined;
}

/**
 * The `exports` keys of a member and whether each is exported (`false` for a `null` target).
 * Without a manifest or an `exports` map, only the package root is an entry point.
 *
 * @param {Member} member
 * @param {string} root
 * @returns {Map<string, boolean>}
 */
function declaredEntries(member, root) {
  /** @type {unknown} */
  let exportsField;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, member.dir, "package.json"), "utf8"),
    );
    exportsField = typeof manifest === "object" && manifest !== null ? manifest.exports : undefined;
  } catch {
    exportsField = undefined;
  }

  if (typeof exportsField !== "object" || exportsField === null || Array.isArray(exportsField)) {
    return new Map([[".", true]]);
  }
  const entries = Object.entries(exportsField).filter(([key]) => key.startsWith("."));
  // An object of conditions (`import`, `default`, ...) describes the package root.
  if (entries.length === 0) return new Map([[".", true]]);
  return new Map(entries.map(([key, value]) => [key, value !== null]));
}

/**
 * Whether `subpath` (`""` or `/x/y`) is an exported entry of `entries`, resolved as Node.js does:
 * an exact key first, then the matching pattern with the longest prefix.
 *
 * @param {Map<string, boolean>} entries
 * @param {string} subpath
 */
function isExported(entries, subpath) {
  const request = `.${subpath}`;
  const exact = entries.get(request);
  if (exact !== undefined) return exact;

  let best = { prefix: -1, exported: false };
  for (const [key, exported] of entries) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    const matches =
      request.startsWith(prefix) &&
      request.endsWith(suffix) &&
      request.length > prefix.length + suffix.length;
    if (matches && prefix.length > best.prefix) best = { prefix: prefix.length, exported };
  }
  return best.exported;
}

/**
 * @param {string[]} names
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
  if (typeof node !== "object" || node === null) return undefined;
  const candidate =
    /** @type {{ type?: unknown, value?: unknown, quasis?: unknown, expressions?: unknown }} */ (
      node
    );
  if (candidate.type === "Literal" && typeof candidate.value === "string") return candidate.value;
  if (
    candidate.type === "TemplateLiteral" &&
    Array.isArray(candidate.expressions) &&
    candidate.expressions.length === 0 &&
    Array.isArray(candidate.quasis)
  ) {
    const [quasi] = /** @type {{ value?: { cooked?: unknown } }[]} */ (candidate.quasis);
    const cooked = quasi?.value?.cooked;
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
      forbiddenPackage:
        "'{{specifier}}' imports {{target}}, which {{importer}} may not import. {{importer}} may import {{allowed}} (dependency table in docs/repository-structure.md).",
      appImport:
        "'{{specifier}}' imports the app {{targetDir}} ({{target}}). Apps are deployables and are never imported; share code through a package allowed by the dependency table in docs/repository-structure.md.",
      unlistedImporter:
        "'{{specifier}}' imports {{target}}, but {{importer}} has no row in the dependency table in docs/repository-structure.md. Add its row there and to the import-boundaries rule of @sebela/config first.",
      undeclaredSubpath:
        "'{{specifier}}' is not a declared export of {{target}}. Import one of its declared entry points: {{entries}}.",
      pathIntoMember:
        "'{{specifier}}' reaches into {{targetDir}} by path, bypassing the public entry of {{target}}. Import it by its package name through a declared entry point instead.",
      pathOutsideMember:
        "'{{specifier}}' leaves {{importer}} by path. Code outside a package is imported only by package name through a declared entry point.",
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
    const fromDir = path.dirname(file);

    /**
     * Checks the table row of the importer for `target`. Returns false after reporting.
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
        context.report({
          node,
          messageId: "forbiddenPackage",
          data: { ...data, importer: importer.dir, allowed: packageList([...allowed]) },
        });
        return false;
      }
      return true;
    }

    /**
     * @param {unknown} source The node holding the module specifier.
     */
    function check(source) {
      const specifier = staticString(source);
      if (specifier === undefined) return;
      const node = /** @type {import("eslint").Rule.Node} */ (source);
      const target = resolveSpecifier(specifier, fromDir);
      if (target === undefined) return;

      if (target.kind === "package") {
        const member = memberNamed(target.name, root);
        const isSelf = importer?.dir === member.dir;
        if (!isSelf && !checkTable(node, specifier, member)) return;
        const entries = declaredEntries(member, root);
        if (!isExported(entries, target.subpath)) {
          const declared = [...entries]
            .filter(([, exported]) => exported)
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
        }
        return;
      }

      const member = memberContaining(target.file, root);
      if (member !== undefined && (member.dir !== importer?.dir || member.installed === true)) {
        if (member.dir !== importer?.dir && !checkTable(node, specifier, member)) return;
        context.report({
          node,
          messageId: "pathIntoMember",
          data: { specifier, target: `${SCOPE}${member.name}`, targetDir: member.dir },
        });
        return;
      }
      if (importer !== undefined && member === undefined) {
        context.report({
          node,
          messageId: "pathOutsideMember",
          data: { specifier, importer: importer.dir },
        });
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
