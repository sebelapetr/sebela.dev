import type { ProfileService } from "@sebela/services";

import type { RouteDefinition } from "../../routing.js";
import { personRoutes } from "./person.js";
import { technologyRoutes } from "./technologies.js";
import { topicRoutes } from "./topics.js";

/**
 * The HTTP routes of the profile: the person and the ordered technology and topic catalogs.
 * Path slugs and bodies are validated by the app before a handler runs.
 */
export function profileRoutes(profile: ProfileService): RouteDefinition[] {
  return [...personRoutes(profile), ...technologyRoutes(profile), ...topicRoutes(profile)];
}
