// The storage entry hides its drivers.
import { storeLocally } from "./drivers/local.js";

export interface StoredFile {
  key: string;
}

export const storeFile = (name: string): StoredFile => storeLocally(name);
