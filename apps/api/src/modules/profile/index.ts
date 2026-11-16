import type { ProfileService } from "@sebela/services";

import type { RouteDefinition } from "../../routing.js";
import { caseStudyRoutes } from "./case-studies.js";
import { educationRoutes } from "./education.js";
import { experienceRoutes } from "./experiences.js";
import { explorationRoutes } from "./explorations.js";
import { organizationRoutes } from "./organizations.js";
import { personRoutes } from "./person.js";
import { projectRoutes } from "./projects.js";
import { serviceRoutes } from "./services.js";
import { technologyRoutes } from "./technologies.js";
import { testimonialRoutes } from "./testimonials.js";
import { topicRoutes } from "./topics.js";

/**
 * The HTTP routes of the profile: the person, the ordered technology and topic catalogs, the
 * organizations, the experiences that relate them, the projects and testimonials each experience
 * owns and the case study of each project, the explorations outside the career timeline, the
 * services that name projects and explorations as their evidence, and the education records.
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
    ...testimonialRoutes(profile),
    ...caseStudyRoutes(profile),
    ...explorationRoutes(profile),
    ...serviceRoutes(profile),
    ...educationRoutes(profile),
  ];
}
