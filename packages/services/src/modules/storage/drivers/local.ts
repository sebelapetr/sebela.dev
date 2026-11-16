import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";

import { fileNameOf, newKey, type KeyPrefix, type StoredExtension } from "../keys.js";

const { O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants;

const hasCode = (error: unknown, ...codes: string[]) =>
  error instanceof Error && "code" in error && codes.includes(String(error.code));

/**
 * Files on local disk below `root`, in one folder per prefix segment. The root is resolved once;
 * every prefix folder must be a real folder, never a symbolic link, and files are created
 * exclusively and opened without following links, so nothing is written, read or removed outside
 * the prefix and no existing file is replaced.
 */
export function createLocalDriver(root: string, prefix: KeyPrefix) {
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
    const name = fileNameOf(prefix, key);
    return name === null ? null : join(await prefixFolder(create), name);
  };

  return {
    async store(file: { bytes: Uint8Array; extension: StoredExtension }): Promise<string> {
      const key = newKey(prefix, file.extension);
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
