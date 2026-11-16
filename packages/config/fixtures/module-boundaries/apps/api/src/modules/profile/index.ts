// The profile HTTP entry: adapts requests to the services package root.
import { getProfile } from "@sebela/services";

import { routePaths } from "./routes.js";

export function registerProfileRoutes(): string[] {
  return routePaths.map((route) => `${route} ${getProfile().name}`);
}
