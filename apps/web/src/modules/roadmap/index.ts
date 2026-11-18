// The roadmap module: the AI Engineering Roadmap's pages under its own sub-navigation — the
// overview (every area, module and resource on the timeline with the API's progress, status and
// estimates, each area and module leading to its own page), an area's page (its modules), a
// module's page (its resources, each with the anchor a source link lands on), the learning diary's
// list and each diary day's page (study time and sessions at Prague's wall-clock times, grouped by
// area and module) and the bookshelf and events addresses as explicit placeholders until their
// pages are published — rendered from the content the profile module reads. Gives the overview's
// lead, the detail pages' breadcrumbs and the diary's names for the pages' metadata.
export { roadmapLead, toRoadmapOverview } from "./data/overview";
export {
  roadmapPageFacts,
  toRoadmapAreaPage,
  toRoadmapModulePage,
  type RoadmapCrumb,
  type RoadmapPageFacts,
} from "./data/detail";
export { DIARY_NAME, formatDiaryDate } from "./data/diary";
export { RoadmapAreaTemplate } from "./templates/area";
export { RoadmapDiaryTemplate } from "./templates/diary";
export { RoadmapDiaryDayTemplate } from "./templates/diary-day";
export { RoadmapModuleTemplate } from "./templates/module";
export { RoadmapOverviewTemplate } from "./templates/overview";
export {
  RoadmapSectionPlaceholderTemplate,
  roadmapSectionName,
  type RoadmapPlaceholderSection,
} from "./templates/section-placeholder";
