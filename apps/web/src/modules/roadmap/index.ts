// The roadmap module: the AI Engineering Roadmap's pages under its own sub-navigation — the
// overview (every area, module and resource on the timeline with the API's progress, status and
// estimates, each area and module leading to its own page), an area's page (its modules), a
// module's page (its resources, each with the anchor a source link lands on), the learning diary's
// list and each diary day's page (study time and sessions at Prague's wall-clock times, grouped by
// area and module), the bookshelf (every book in shelf order with its derived status) and each
// book's page (its facts, progress, reading time, resource and summary) and the events (newest
// first, grouped by the year they start in; each also shown on the diary's days it covers, with the
// time spent at it) and the learning statistics (the API's totals split into resources, books and
// events, study time by area and module, recent days, weeks and months, and the resources and
// events with time, each leading to its evidence), the overview's supporting sections (project
// ideas, followed sources, the FAQ and additional terms) and the reading guide beside the bookshelf
// — rendered from the content the profile module reads. Gives every page's facts for its metadata,
// structured data and preview image.
export {
  roadmapPageFacts,
  toRoadmapAreaPage,
  toRoadmapModulePage,
  type RoadmapCrumb,
  type RoadmapPageFacts,
} from "./data/detail";
export {
  bookPageFacts,
  bookshelfPageFacts,
  type BookPageFacts,
  type BookshelfPageFacts,
} from "./data/bookshelf";
export {
  diaryDayPageFacts,
  diaryPageFacts,
  eventsPageFacts,
  overviewPageFacts,
  readingGuidePageFacts,
  statisticsPageFacts,
} from "./data/page-facts";
export { RoadmapBookTemplate } from "./templates/book";
export { RoadmapBookshelfTemplate } from "./templates/bookshelf";
export { RoadmapAreaTemplate } from "./templates/area";
export { RoadmapDiaryTemplate } from "./templates/diary";
export { RoadmapDiaryDayTemplate } from "./templates/diary-day";
export { RoadmapEventsTemplate } from "./templates/events";
export { RoadmapModuleTemplate } from "./templates/module";
export { RoadmapOverviewTemplate } from "./templates/overview";
export { RoadmapReadingGuideTemplate } from "./templates/reading-guide";
export { RoadmapStatisticsTemplate } from "./templates/statistics";
