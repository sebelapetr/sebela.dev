import type {
  RoadmapContent,
  RoadmapDiaryContent,
  RoadmapDiaryDayContent,
  RoadmapEventsContent,
} from "../../profile";

function notYet(content: { readonly name: string }): never {
  throw new Error(`Not implemented yet for ${content.name}.`);
}

export function overviewPageFacts(content: RoadmapContent): unknown {
  return notYet(content);
}

export function diaryPageFacts(content: RoadmapDiaryContent): unknown {
  return notYet(content);
}

export function diaryDayPageFacts(content: RoadmapDiaryDayContent): unknown {
  return notYet(content);
}

export function statisticsPageFacts(content: { readonly name: string }): unknown {
  return notYet(content);
}

export function eventsPageFacts(content: RoadmapEventsContent): unknown {
  return notYet(content);
}

export function readingGuidePageFacts(content: { readonly name: string }): unknown {
  return notYet(content);
}
