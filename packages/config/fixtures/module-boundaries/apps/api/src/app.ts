// Composition code: registers the HTTP modules through their entries.
import { registerProfileRoutes } from "./modules/profile/index.js";

export function createApp(): string[] {
  return registerProfileRoutes();
}
