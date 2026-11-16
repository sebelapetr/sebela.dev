// @ts-check

// The backend module layout of docs/repository-structure.md as the `sebela/import-boundaries`
// rule checks it: which module a file belongs to, which file is a module's entry, which files are
// tooling configurations, and the dependency graph between the modules of one workspace member,
// read from the source files on disk. Private to `@sebela/config`.
//
// A module is a folder `<member>/src/modules/<name>/`; every file below it, at any depth and
// including its tests, belongs to the module. Its entry is `index.<ext>` directly in that folder
// (or the folder itself as a directory import); every other file is private. A tooling
// configuration is a `*.config.<ext>` file directly in a member folder.

import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { exportFiles, importTargets, memberContaining } from "./import-resolution.js";

/** @typedef {import("./import-resolution.js").Member} Member */

/**
 * @typedef {object} Module
 * @property {Member} member The member that owns the module.
 * @property {string} dir The absolute module folder.
 * @property {string} label The module folder relative to the workspace root, e.g.
 *   `packages/services/src/modules/storage`.
 */

const SOURCE_EXTENSION = /\.(?:d\.[cm]?ts|[cm]?[jt]sx?)$/u;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/** TypeScript resolves an import of `x.js` to `x.ts` as well; these are the other candidates. */
const SOURCE_FOR_OUTPUT = new Map([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);

/**
 * `file` without its JavaScript or TypeScript extension, if it has one.
 *
 * @param {string} file
 */
function withoutExtension(file) {
  return file.replace(SOURCE_EXTENSION, "");
}

/**
 * `file` relative to `dir` with forward slashes, or `undefined` when it is not inside `dir`.
 *
 * @param {string} dir
 * @param {string} file
 */
function inside(dir, file) {
  const relative = path.relative(dir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

/**
 * The module `file` belongs to, or `undefined` for a file outside every module folder.
 *
 * @param {string} file
 * @param {string} root
 * @returns {Module | undefined}
 */
export function moduleOf(file, root) {
  const member = memberContaining(file, root);
  if (member === undefined || member.installed === true) return undefined;
  const memberDir = path.join(root, member.dir);
  const [src, modules, name, ...rest] = (inside(memberDir, file) ?? "").split("/");
  if (src !== "src" || modules !== "modules" || !name) return undefined;
  if (rest.length === 0 && SOURCE_EXTENSION.test(name)) return undefined;
  return {
    member,
    dir: path.join(memberDir, "src", "modules", name),
    label: `${member.dir}/src/modules/${name}`,
  };
}

/**
 * Whether `file`, a file or folder inside `module`, is the module's entry.
 *
 * @param {string} file
 * @param {Module} module
 */
export function isModuleEntry(file, module) {
  const relative = inside(module.dir, file);
  return relative === "" || (relative !== undefined && withoutExtension(relative) === "index");
}

/**
 * Whether `file` is a tooling configuration (`*.config.<ext>`) directly in its member folder.
 *
 * @param {string} file
 * @param {string} root
 */
export function isToolingConfig(file, root) {
  const member = memberContaining(file, root);
  if (member === undefined || member.installed === true) return false;
  if (path.dirname(file) !== path.join(root, member.dir)) return false;
  return /.\.config$/u.test(withoutExtension(path.basename(file)));
}

/**
 * The source file an import of `file` loads: the file itself, the TypeScript source of an output
 * name, the file with an extension added, or the `index` file of a folder.
 *
 * @param {string} file
 * @returns {string | undefined}
 */
function sourceFile(file) {
  const extension = path.extname(file);
  const candidates = [
    file,
    ...(SOURCE_FOR_OUTPUT.get(extension) ?? []).map(
      (other) => file.slice(0, -extension.length) + other,
    ),
    ...SOURCE_EXTENSIONS.map((other) => file + other),
    ...SOURCE_EXTENSIONS.map((other) => path.join(file, `index${other}`)),
  ];
  return candidates.find((candidate) =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
  );
}

/** @type {Map<string, { stamp: string, specifiers: string[] }>} */
const parsed = new Map();

/**
 * Every literal module specifier in `file`: static imports and re-exports (type-only ones too),
 * `import x = require()`, `import()` and `require()` with a literal argument, and `typeof
 * import()`. Parsed once per version of the file.
 *
 * @param {string} file
 * @returns {string[]}
 */
function specifiersIn(file) {
  const stats = fs.statSync(file, { throwIfNoEntry: false });
  if (stats === undefined) return [];
  const stamp = `${String(stats.mtimeMs)}:${String(stats.ctimeMs)}:${String(stats.size)}`;
  const cached = parsed.get(file);
  if (cached?.stamp === stamp) return cached.specifiers;

  const extension = path.extname(file);
  const kind =
    extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : /^\.[cm]?js$/u.test(extension)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    kind,
  );

  /** @type {string[]} */
  const specifiers = [];
  /** @param {ts.Node | undefined} node */
  const add = (node) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  parsed.set(file, { stamp, specifiers });
  return specifiers;
}

/**
 * Every source file below `dir`.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function sourceFilesBelow(dir) {
  try {
    return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && SOURCE_EXTENSION.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * The dependency graph between the units of one member: each module is one unit, every other
 * file is a unit of its own. A cycle is reported only when it passes through a module.
 *
 * @param {object} options
 * @param {string} options.root The workspace root.
 * @param {Member} options.member The member whose units the graph holds.
 * @param {string} options.importer The linted file, whose unit every cycle must return to.
 * @param {import("typescript").CompilerOptions | undefined} [options.compilerOptions] For `paths` aliases.
 * @param {string | undefined} [options.currentDirectory] The TypeScript program's current directory.
 */
export function createModuleGraph({ root, member, importer, compilerOptions, currentDirectory }) {
  const memberDir = path.join(root, member.dir);
  const manifestDir = memberDir;

  /** @typedef {{ key: string, isModule: boolean, files: () => string[] }} Unit */

  /**
   * The unit that an import of `file` (a path, possibly without its extension) reaches, or
   * `undefined` outside this member.
   *
   * @param {string} file
   * @returns {Unit | undefined}
   */
  function unitOf(file) {
    if (memberContaining(file, root)?.dir !== member.dir || inside(memberDir, file) === undefined) {
      return undefined;
    }
    const module = moduleOf(file, root);
    if (module !== undefined) {
      return {
        key: inside(memberDir, module.dir) ?? module.dir,
        isModule: true,
        files: () => sourceFilesBelow(module.dir),
      };
    }
    const loaded = sourceFile(file);
    const key = inside(memberDir, withoutExtension(loaded ?? file)) ?? file;
    return { key, isModule: false, files: () => (loaded === undefined ? [] : [loaded]) };
  }

  /**
   * The files within this member that `specifier`, written in `from`, loads.
   *
   * @param {string} specifier
   * @param {string} from
   * @returns {string[]}
   */
  function filesImported(specifier, from) {
    return importTargets(specifier, { file: from, manifestDir, compilerOptions, currentDirectory })
      .flatMap((target) => {
        if (target.kind === "path") return [target.file];
        return target.name === member.name ? exportFiles(member, target.subpath, root) : [];
      })
      .filter((file) => memberContaining(file, root)?.dir === member.dir);
  }

  /** @type {Map<string, Unit[]>} */
  const dependencies = new Map();

  /**
   * The units `unit` imports, other than itself.
   *
   * @param {Unit} unit
   * @returns {Unit[]}
   */
  function dependenciesOf(unit) {
    const known = dependencies.get(unit.key);
    if (known !== undefined) return known;
    /** @type {Map<string, Unit>} */
    const found = new Map();
    for (const file of unit.files()) {
      for (const specifier of specifiersIn(file)) {
        for (const imported of filesImported(specifier, file)) {
          const other = unitOf(imported);
          if (other !== undefined && other.key !== unit.key) found.set(other.key, other);
        }
      }
    }
    const result = [...found.values()];
    dependencies.set(unit.key, result);
    return result;
  }

  const start = unitOf(importer);
  /**
   * Search states (a unit and whether a module was passed) known not to lead back to `start`.
   * Only the states of a search that found no cycle are added: a state abandoned while another
   * branch of a successful search was still open may yet lead back.
   */
  /** @type {Set<string>} */
  const deadEnds = new Set();

  /**
   * The cycle that an import of `target` from the linted file closes, as unit keys relative to
   * the member from the linted file's unit back to it, or `undefined` when there is none.
   *
   * @param {string} target
   * @returns {string[] | undefined}
   */
  function cycleThrough(target) {
    const first = unitOf(target);
    if (start === undefined || first === undefined || first.key === start.key) return undefined;

    /**
     * @param {Unit} unit
     * @param {boolean} passedModule
     * @returns {string[] | undefined}
     */
    const search = (unit, passedModule) => {
      const passed = passedModule || unit.isModule;
      const state = `${unit.key}\0${String(passed)}`;
      if (deadEnds.has(state) || visited.has(state)) return undefined;
      visited.add(state);
      for (const next of dependenciesOf(unit)) {
        if (next.key === start.key) {
          if (passed) return [unit.key, start.key];
          continue;
        }
        const rest = search(next, passed);
        if (rest !== undefined) return [unit.key, ...rest];
      }
      return undefined;
    };

    /** @type {Set<string>} */
    const visited = new Set();
    const cycle = search(first, start.isModule);
    if (cycle === undefined) for (const state of visited) deadEnds.add(state);
    return cycle && [start.key, ...cycle];
  }

  return { cycleThrough };
}
