import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { fileNameOf, newKey, storedExtensions, type KeyPrefix } from "../keys.js";
import { markerName, type NamespaceStore } from "../namespace.js";

const { O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants;

const hasCode = (error: unknown, ...codes: string[]) =>
  error instanceof Error && "code" in error && codes.includes(String(error.code));

/**
 * Files on local disk below `root`, in one folder per prefix segment. The root is resolved once;
 * every prefix folder must be a real folder, never a symbolic link, and files are created
 * exclusively and opened without following links, so nothing is written, read or removed outside
 * the prefix and no existing file is replaced. Only names with one of `extensions` are keys.
 */
export function createLocalDriver(
  root: string,
  prefix: KeyPrefix,
  extensions: readonly string[] = storedExtensions,
) {
  let resolvedRoot: Promise<string> | undefined;

  const rootFolder = () => {
    resolvedRoot ??= mkdir(root, { recursive: true }).then(() => realpath(root));
    return resolvedRoot.catch((error: unknown) => {
      resolvedRoot = undefined;
      throw error;
    });
  };

  /** The prefix folder, each level checked to be a real folder; created when `create` is set. */
  const prefixFolder = async (create: boolean): Promise<string> => {
    let folder = await rootFolder();
    for (const segment of prefix) {
      folder = join(folder, segment);
      if (create) {
        try {
          await mkdir(folder, { mode: 0o750 });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      const status = await lstat(folder);
      if (!status.isDirectory()) {
        throw new Error("A storage prefix folder is not a real folder; refusing to use it.");
      }
    }
    return folder;
  };

  const pathOf = async (key: string, create: boolean): Promise<string | null> => {
    const name = fileNameOf(prefix, key, extensions);
    return name === null ? null : join(await prefixFolder(create), name);
  };

  return {
    async store(file: { bytes: Uint8Array; extension: string }): Promise<string> {
      const key = newKey(prefix, file.extension, extensions);
      const path = await pathOf(key, true);
      if (path === null) throw new Error("A generated key is outside the prefix.");
      const handle = await open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o640);
      try {
        await handle.writeFile(file.bytes);
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(path).catch(() => undefined);
        throw error;
      }
      return key;
    },

    async delete(key: string): Promise<void> {
      const path = await pathOf(key, false).catch((error: unknown) => {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      });
      if (path === null) throw new Error("The key is not a key of this storage.");
      if (path === undefined) return;
      try {
        await unlink(path);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    },

    async read(key: string): Promise<Uint8Array | null> {
      try {
        const path = await pathOf(key, false);
        if (path === null) return null;
        const handle = await open(path, O_RDONLY | O_NOFOLLOW);
        try {
          if (!(await handle.stat()).isFile()) return null;
          return await handle.readFile();
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (hasCode(error, "ENOENT", "ELOOP", "EISDIR", "ENOTDIR")) return null;
        throw error;
      }
    },
  };
}

/**
 * The namespace folder `<root>/<prefix…>` for the owner-guarded namespace. Every existing level must
 * be a real folder, never a symbolic link; the marker is read and created without following links,
 * and clearing removes the folder's entries without following any link inside it.
 */
export function createLocalNamespaceStore(root: string, prefix: KeyPrefix): NamespaceStore {
  /** The namespace folder, or `null` when part of it does not exist and `create` is not set. */
  const folder = async (create: boolean): Promise<string | null> => {
    if (create) await mkdir(root, { recursive: true });
    let path: string;
    try {
      path = await realpath(root);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    for (const segment of prefix) {
      path = join(path, segment);
      if (create) {
        try {
          await mkdir(path, { mode: 0o750 });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      let status;
      try {
        status = await lstat(path);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        throw error;
      }
      if (!status.isDirectory()) {
        throw new Error("A storage prefix folder is not a real folder; refusing to use it.");
      }
    }
    return path;
  };

  return {
    async readMarker() {
      const path = await folder(false);
      if (path === null) return null;
      let handle;
      try {
        handle = await open(join(path, markerName), O_RDONLY | O_NOFOLLOW);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        if (hasCode(error, "ELOOP")) {
          throw new Error("The storage owner marker is a symbolic link; refusing to use it.", {
            cause: error,
          });
        }
        throw error;
      }
      try {
        if (!(await handle.stat()).isFile()) {
          throw new Error("The storage owner marker is not a file; refusing to use it.");
        }
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    },

    async hasFiles() {
      const path = await folder(false);
      if (path === null) return false;
      return (await readdir(path)).some((name) => name !== markerName);
    },

    async writeMarker(content) {
      const path = await folder(true);
      if (path === null) throw new Error("The storage folder could not be created.");
      const handle = await open(
        join(path, markerName),
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
        0o640,
      );
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
    },

    async clear() {
      const path = await folder(false);
      if (path === null) return;
      for (const name of await readdir(path)) {
        if (name !== markerName) await rm(join(path, name), { recursive: true, force: true });
      }
      await rm(join(path, markerName), { force: true });
      await rmdir(path);
    },
  };
}
