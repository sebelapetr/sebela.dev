// The profile persistence entry.
import { profileTable } from "./schema.js";

export const readProfile = (): { name: string } => ({ name: profileTable.name });
