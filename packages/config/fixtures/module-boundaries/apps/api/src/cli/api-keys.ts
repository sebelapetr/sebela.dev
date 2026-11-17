// A maintenance adapter: uses services through the package root, never db.
import { createApiKey } from "@sebela/services";

export const run = (name: string): string => createApiKey(name);
