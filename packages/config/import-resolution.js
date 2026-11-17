// @ts-check

// Where a module specifier leads, as the `sebela/import-boundaries` rule and its module graph see
// it: the workspace root and members, `exports` and `imports` maps of the members' manifests, and
// `paths` aliases through TypeScript's own module resolution. Private to `@sebela/config`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export const SCOPE = "@sebela/";
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** The apps of the repository layout. Apps are deployables and are never imported. */
const APPS = new Set(["web", "api", "mcp-admin", "llm-agent"]);

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
 * What resolving a specifier needs besides the specifier: the importing file, the folder of the
 * manifest whose `imports` map applies, and the TypeScript compiler options for aliases, if any.
 *
 * @typedef {object} ResolutionContext
 * @property {string} file
 * @property {string} manifestDir
 * @property {ts.CompilerOptions | undefined} [compilerOptions]
 * @property {string | undefined} [currentDirectory] The TypeScript program's current directory.
 */

/**
 * The nearest ancestor of `dir` that contains the workspace marker, or `undefined`.
 *
 * @param {string} dir
 * @returns {string | undefined}
 */
export function findWorkspaceRoot(dir) {
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
export function memberNamed(name, root) {
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
export function memberContaining(file, root) {
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
export function resolveSpecifier(specifier, fromDir) {
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
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parsed `package.json` in `dir`, or `undefined` when it is missing or unreadable.
 *
 * @param {string} dir
 * @returns {Record<string, unknown> | undefined}
 */
export function readManifest(dir) {
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
export function exportsMap(member, root) {
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
export function matchSubpath(map, request) {
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
export function stringTargets(value, star) {
  if (typeof value === "string") return [value.replaceAll("*", star)];
  if (Array.isArray(value)) return value.flatMap((item) => stringTargets(item, star));
  if (isRecord(value)) return Object.values(value).flatMap((item) => stringTargets(item, star));
  return [];
}

/**
 * The files the declared export `@sebela/<member><subpath>` leads to, in every condition. A
 * member without a manifest or `exports`, or a subpath it does not declare, gives no files.
 *
 * @param {Member} member
 * @param {string} subpath `""` for the package root, otherwise `/x`.
 * @param {string} root
 * @returns {string[]}
 */
export function exportFiles(member, subpath, root) {
  const match = matchSubpath(exportsMap(member, root), `.${subpath}`);
  if (match === undefined) return [];
  const memberDir = path.join(root, member.dir);
  return stringTargets(match.value, match.star)
    .filter((target) => target.startsWith("./"))
    .map((target) => path.resolve(memberDir, target));
}

/** @type {WeakMap<ts.CompilerOptions, ts.ModuleResolutionCache>} */
const resolutionCaches = new WeakMap();

/**
 * The workspace file a bare specifier resolves to through TypeScript's module resolution with
 * `options` (for example a `paths` alias), or `undefined` for an unresolved specifier or an
 * installed library.
 *
 * @param {ts.CompilerOptions} options
 * @param {string} currentDirectory
 * @param {string} specifier
 * @param {string} file
 * @returns {string | undefined}
 */
function resolveThroughTypeScript(options, currentDirectory, specifier, file) {
  let cache = resolutionCaches.get(options);
  if (cache === undefined) {
    cache = ts.createModuleResolutionCache(currentDirectory, (name) => name, options);
    resolutionCaches.set(options, cache);
  }
  const { resolvedModule } = ts.resolveModuleName(specifier, file, options, ts.sys, cache);
  if (resolvedModule === undefined || resolvedModule.isExternalLibraryImport === true) {
    return undefined;
  }
  return path.resolve(resolvedModule.resolvedFileName);
}

/**
 * Where `specifier` leads: directly (a package name or a path), through the `imports` map of the
 * manifest in `manifestDir` for `#` subpath imports, or through TypeScript's module resolution for
 * any other bare specifier when compiler options are given.
 *
 * @param {string} specifier
 * @param {ResolutionContext} context
 * @returns {Target[]}
 */
export function importTargets(
  specifier,
  { file, manifestDir, compilerOptions, currentDirectory = path.dirname(file) },
) {
  if (specifier.startsWith("#")) {
    const imports = readManifest(manifestDir)?.["imports"];
    const match = isRecord(imports) ? matchSubpath(imports, specifier) : undefined;
    if (match === undefined) return [];
    return stringTargets(match.value, match.star).flatMap((mapped) => {
      const target = resolveSpecifier(mapped, manifestDir);
      return target === undefined ? [] : [target];
    });
  }

  const direct = resolveSpecifier(specifier, path.dirname(file));
  if (direct !== undefined) return [direct];

  if (compilerOptions === undefined || specifier.startsWith("node:")) return [];
  const resolved = resolveThroughTypeScript(compilerOptions, currentDirectory, specifier, file);
  return resolved === undefined ? [] : [{ kind: "path", file: resolved }];
}
