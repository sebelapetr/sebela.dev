import type { StorageNamespace } from "./index.js";

/** Not implemented yet. */
export function ownedNamespace(...args: [unknown, string, unknown]): StorageNamespace {
  throw new Error(`Not implemented yet (${String(args.length)} arguments).`);
}
