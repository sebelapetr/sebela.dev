// The media entry uses other modules only through their entries: relative, aliased and dynamic.
import type { StoredFile } from "#modules/storage/index.js";
import { getProfile } from "~services/modules/profile/index.js";

import { storeFile } from "../storage/index.js";

export async function attachMedia(name: string): Promise<StoredFile> {
  const storage = await import("../storage/index.js");
  return getProfile().name === "" ? storeFile(name) : storage.storeFile(name);
}
