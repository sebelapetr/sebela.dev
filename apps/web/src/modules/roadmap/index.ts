// The roadmap module: the AI Engineering Roadmap's pages under its own sub-navigation — the
// overview (every area, module and resource on the timeline with the API's progress, status and
// estimates), an area's address and the diary, bookshelf and events addresses as explicit
// placeholders until their pages are published — rendered from the content the profile module
// reads. Finds an area by its slug and gives the overview's lead for the page's metadata.
export { findRoadmapArea, roadmapLead, toRoadmapOverview } from "./data/overview";
export type { RoadmapAreaHeading } from "./data/overview";
export { RoadmapAreaPlaceholderTemplate } from "./templates/area-placeholder";
export { RoadmapOverviewTemplate } from "./templates/overview";
export {
  RoadmapSectionPlaceholderTemplate,
  roadmapSectionName,
  type RoadmapPlaceholderSection,
} from "./templates/section-placeholder";
