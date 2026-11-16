import type { ProfileService } from "@sebela/services";

import type { RouteDefinition } from "../../routing.js";
import { caseStudyRoutes } from "./case-studies.js";
import { experienceRoutes } from "./experiences.js";
import { explorationRoutes } from "./explorations.js";
import { organizationRoutes } from "./organizations.js";
import { personRoutes } from "./person.js";
import { projectRoutes } from "./projects.js";
import { serviceRoutes } from "./services.js";
import { technologyRoutes } from "./technologies.js";
import { topicRoutes } from "./topics.js";

/**
 * The HTTP routes of the profile: the person, the ordered technology and topic catalogs, the
 * organizations, the experiences that relate them, the projects each experience owns and the case
 * study of each project, the explorations outside the career timeline, and the services that
 * name projects and explorations as their evidence.
 * Path slugs and bodies are validated by the app before a handler runs.
 */
export function profileRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    ...personRoutes(profile),
    ...technologyRoutes(profile),
    ...topicRoutes(profile),
    ...organizationRoutes(profile),
    ...experienceRoutes(profile),
    ...projectRoutes(profile),
    ...caseStudyRoutes(profile),
    ...explorationRoutes(profile),
    ...serviceRoutes(profile),
  ];
}
