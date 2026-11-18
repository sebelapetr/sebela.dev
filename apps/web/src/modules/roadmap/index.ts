// The roadmap module: the AI Engineering Roadmap's pages under its own sub-navigation — the
// overview (every area, module and resource on the timeline with the API's progress, status and
// estimates, each area and module leading to its own page), an area's page (its modules), a
// module's page (its resources, each with the anchor a source link lands on), the learning diary's
// list and each diary day's page (study time and sessions at Prague's wall-clock times, grouped by
// area and module), the bookshelf (every book in shelf order with its derived status) and each
// book's page (its facts, progress, reading time, resource and summary) and the events (newest
// first, grouped by the year they start in; each also shown on the diary's days it covers, with the
// time spent at it) — rendered from the content the profile module reads. Gives the overview's
// lead, the detail pages' breadcrumbs, the diary's and events' names and the bookshelf's and books'
// page facts for the pages' metadata.
export { roadmapLead, toRoadmapOverview } from "./data/overview";
export {
  roadmapPageFacts,
  toRoadmapAreaPage,
  toRoadmapModulePage,
  type RoadmapCrumb,
  type RoadmapPageFacts,
} from "./data/detail";
export { DIARY_NAME, formatDiaryDate } from "./data/diary";
export { EVENTS_NAME } from "./data/events";
export {
  BOOKSHELF_NAME,
  bookPageFacts,
  bookshelfPageFacts,
  type BookPageFacts,
  type BookshelfPageFacts,
} from "./data/bookshelf";
export { RoadmapBookTemplate } from "./templates/book";
export { RoadmapBookshelfTemplate } from "./templates/bookshelf";
export { RoadmapAreaTemplate } from "./templates/area";
export { RoadmapDiaryTemplate } from "./templates/diary";
export { RoadmapDiaryDayTemplate } from "./templates/diary-day";
export { RoadmapEventsTemplate } from "./templates/events";
export { RoadmapModuleTemplate } from "./templates/module";
export { RoadmapOverviewTemplate } from "./templates/overview";
