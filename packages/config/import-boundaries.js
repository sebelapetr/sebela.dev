// @ts-check

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

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
 * - Aliases are checked where they lead: `#` subpath imports through the `imports` map of the
 *   importer's `package.json`, and, in type-checked TypeScript files, any other bare specifier
 *   that the TypeScript program resolves to a file of the workspace (for example `paths`).
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
 * Where a specifier leads: a workspace package by name, or a file path.
 *
 * @typedef {{ kind: "package", name: string, subpath: string } | { kind: "path", file: string }} Target
 */

/** @typedef {Record<string, unknown>} SubpathMap The `exports` or `imports` map of a manifest. */

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
 * Resolves a package-name, `file:`, absolute or relative specifier. Other specifiers (third-party
 * packages, built-ins, aliases) give `undefined`.
 *
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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parsed `package.json` in `dir`, or `undefined` when it is missing or unreadable.
 *
 * @param {string} dir
 * @returns {Record<string, unknown> | undefined}
 */
function readManifest(dir) {
  try {
    /** @type {unknown} */
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return isRecord(manifest) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The entry points of a member as an `exports` map keyed by subpath (`.`, `./x`, `./x/*`).
 * Without a manifest or an `exports` field only the package root is an entry point; a string,
 * array or object of conditions describes the package root as well.
 *
 * @param {Member} member
 * @param {string} root
 * @returns {SubpathMap}
 */
function exportsMap(member, root) {
  const field = readManifest(path.join(root, member.dir))?.["exports"];
  if (field === undefined || field === null) return { ".": true };
  if (!isRecord(field)) return { ".": field };
  const subpaths = Object.entries(field).filter(([key]) => key.startsWith("."));
  return subpaths.length === 0 ? { ".": field } : Object.fromEntries(subpaths);
}

/**
 * Resolves `request` against a subpath map as Node.js does: an exact key first, then the pattern
 * key with the longest prefix. Returns the matched target and the text `*` stands for.
 *
 * @param {SubpathMap} map
 * @param {string} request
 * @returns {{ value: unknown, star: string } | undefined}
 */
function matchSubpath(map, request) {
  if (Object.hasOwn(map, request)) return { value: map[request], star: "" };

  /** @type {{ key: string, prefix: number, star: string } | undefined} */
  let best;
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    const matches =
      request.startsWith(prefix) &&
      request.endsWith(suffix) &&
      request.length > prefix.length + suffix.length;
    if (matches && prefix.length > (best?.prefix ?? -1)) {
      best = {
        key,
        prefix: prefix.length,
        star: request.slice(prefix.length, request.length - suffix.length),
      };
    }
  }
  return best && { value: map[best.key], star: best.star };
}

/**
 * Every string target of a subpath map value, including those nested in conditions and
 * fallback arrays, with `*` replaced by `star`.
 *
 * @param {unknown} value
 * @param {string} star
 * @returns {string[]}
 */
function stringTargets(value, star) {
  if (typeof value === "string") return [value.replaceAll("*", star)];
  if (Array.isArray(value)) return value.flatMap((item) => stringTargets(item, star));
  if (isRecord(value)) return Object.values(value).flatMap((item) => stringTargets(item, star));
  return [];
}

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

/** @type {WeakMap<ts.Program, ts.ModuleResolutionCache>} */
const resolutionCaches = new WeakMap();

/**
 * The workspace file a bare specifier resolves to through the TypeScript program (for example a
 * `paths` alias), or `undefined` for an unresolved specifier or an installed library.
 *
 * @param {ts.Program} program
 * @param {string} specifier
 * @param {string} file
 * @returns {string | undefined}
 */
function resolveThroughProgram(program, specifier, file) {
  const options = program.getCompilerOptions();
  let cache = resolutionCaches.get(program);
  if (cache === undefined) {
    cache = ts.createModuleResolutionCache(program.getCurrentDirectory(), (name) => name, options);
    resolutionCaches.set(program, cache);
  }
  const { resolvedModule } = ts.resolveModuleName(specifier, file, options, ts.sys, cache);
  if (resolvedModule === undefined || resolvedModule.isExternalLibraryImport === true) {
    return undefined;
  }
  return path.resolve(resolvedModule.resolvedFileName);
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
        "'{{specifier}}' reaches into {{targetDir}} by path or alias, bypassing the public entry of {{target}}. Import it by its package name through a declared entry point instead.",
      pathOutsideMember:
        "'{{specifier}}' leaves {{importer}} by path or alias. Code outside a package is imported only by package name through a declared entry point.",
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
    const manifestDir = importer === undefined ? root : path.join(root, importer.dir);
    const program = /** @type {{ program?: ts.Program | null } | undefined} */ (
      context.sourceCode.parserServices
    )?.program;

    /**
     * Where `specifier` leads: directly, through the `imports` map of the importer's manifest, or
     * through the TypeScript program.
     *
     * @param {string} specifier
     * @returns {Target[]}
     */
    function targetsOf(specifier) {
      if (specifier.startsWith("#")) {
        const imports = readManifest(manifestDir)?.["imports"];
        const match = isRecord(imports) ? matchSubpath(imports, specifier) : undefined;
        if (match === undefined) return [];
        return stringTargets(match.value, match.star).flatMap((mapped) => {
          const target = resolveSpecifier(mapped, manifestDir);
          return target === undefined ? [] : [target];
        });
      }

      const direct = resolveSpecifier(specifier, fromDir);
      if (direct !== undefined) return [direct];

      if (program == null || specifier.startsWith("node:")) return [];
      const resolved = resolveThroughProgram(program, specifier, file);
      return resolved === undefined ? [] : [{ kind: "path", file: resolved }];
    }

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
     * Checks the module specifier held by `source`, reporting at most one violation.
     *
     * @param {unknown} source
     */
    function check(source) {
      const specifier = staticString(source);
      if (specifier === undefined) return;
      const node = /** @type {import("eslint").Rule.Node} */ (source);
      for (const target of targetsOf(specifier)) {
        if (!checkTarget(node, specifier, target)) return;
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
