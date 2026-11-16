import type { ServicePersistence } from "./types.js";

// Stub: the service persistence is specified by services.test.ts and not implemented yet.
export function createServicePersistence(): ServicePersistence {
  const missing = () => Promise.reject(new Error("Not implemented."));
  return {
    listServices: missing,
    findService: missing,
    createService: missing,
    updateService: missing,
    deleteService: missing,
  };
}
