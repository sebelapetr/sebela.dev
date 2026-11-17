import type { StorageNamespace } from "./index.js";

/**
 * What a driver offers to manage one namespace: the folder `<environment>/<worktree>/` and the
 * owner marker inside it. Paths and keys stay inside the driver.
 */
export interface NamespaceStore {
  /** The marker's content, or `null` when there is none. */
  readMarker(): Promise<string | null>;
  /** Whether anything other than the marker is stored in the namespace. */
  hasFiles(): Promise<boolean>;
  /** Writes the marker into the namespace, creating its folder. */
  writeMarker(content: string): Promise<void>;
  /** Removes every file of the namespace, the marker last. */
  clear(): Promise<void>;
}

interface NamespaceLayout {
  readonly environment: string;
  readonly worktree: string | null;
}

/** The name the harness records as a worktree's owner: its folder name. */
const ownerPattern = /^[A-Za-z0-9._-]{1,128}$/;

/** The marker a namespace carries so it is removed only by the worktree that prepared it. */
export const markerName = ".owner";

const markerOf = (owner: string) => `sebela worktree:${owner}\n`;

/**
 * The namespace of one development worktree, guarded by its owner marker. Refuses, without touching
 * anything, a layout without a worktree folder, the production environment and an invalid owner;
 * refuses a namespace another worktree owns and files that carry no marker.
 */
export function ownedNamespace(
  layout: NamespaceLayout,
  owner: string,
  store: NamespaceStore,
): StorageNamespace {
  const guard = () => {
    if (layout.worktree === null) {
      throw new Error("Storage has no worktree folder (STORAGE_WORKTREE); refusing to use it.");
    }
    if (layout.environment === "production") {
      throw new Error("Storage is the production environment; refusing to use it.");
    }
    if (!ownerPattern.test(owner) || owner === "." || owner === "..") {
      throw new Error("The worktree name is not a valid owner; refusing to use it.");
    }
  };

  /** Whether the namespace is this owner's or nobody's yet; anything else is refused. */
  const ownership = async (): Promise<"own" | "none"> => {
    const marker = await store.readMarker();
    if (marker === markerOf(owner)) return "own";
    if (marker !== null) {
      throw new Error("The storage folder belongs to another worktree; refusing to use it.");
    }
    if (await store.hasFiles()) {
      throw new Error("The storage folder has files but no owner marker; refusing to use it.");
    }
    return "none";
  };

  return {
    async prepare() {
      guard();
      if ((await ownership()) === "own") return "reused";
      await store.writeMarker(markerOf(owner));
      return "created";
    },

    async remove() {
      guard();
      if ((await ownership()) === "none") return "absent";
      await store.clear();
      return "removed";
    },
  };
}
