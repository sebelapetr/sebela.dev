import type { ServiceService } from "./types.js";

const unimplemented = () => Promise.reject(new Error("Not implemented."));

export function createServiceService(): ServiceService {
  return {
    listServices: unimplemented,
    getService: unimplemented,
    createService: unimplemented,
    updateService: unimplemented,
    deleteService: unimplemented,
  };
}
