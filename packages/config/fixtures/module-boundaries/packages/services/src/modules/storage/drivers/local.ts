// A private driver of the storage module, reaching back to the module's own entry for a type.
import type { StoredFile } from "../index.js";

export const storeLocally = (name: string): StoredFile => ({ key: `demo/${name}` });
