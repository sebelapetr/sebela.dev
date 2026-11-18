// The roadmap module: the AI Engineering Roadmap's pages under its own sub-navigation — the
// overview (every area, module and resource on the timeline with the API's progress, status and
// estimates, each area and module leading to its own page), an area's page (its modules), a
// module's page (its resources, each with the anchor a source link lands on) and the diary,
// bookshelf and events addresses as explicit placeholders until their pages are published —
// rendered from the content the profile module reads. Gives the overview's lead and the detail
// pages' breadcrumbs for the pages' metadata.
export { roadmapLead, toRoadmapOverview } from "./data/overview";
export {
  roadmapPageFacts,
  toRoadmapAreaPage,
  toRoadmapModulePage,
  type RoadmapCrumb,
  type RoadmapPageFacts,
} from "./data/detail";
export { RoadmapAreaTemplate } from "./templates/area";
export { RoadmapModuleTemplate } from "./templates/module";
export { RoadmapOverviewTemplate } from "./templates/overview";
export {
  RoadmapSectionPlaceholderTemplate,
  roadmapSectionName,
  type RoadmapPlaceholderSection,
} from "./templates/section-placeholder";
