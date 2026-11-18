// The event contracts, private to the roadmap module and re-exported by its entry. Not implemented
// yet: the schemas refuse everything.
import { z } from "zod";

export const roadmapEventKinds = [] as const;

export const DiaryEventSchema = z.never();
export const RoadmapEventSchema = z.never();
export const RoadmapEventListSchema = z.array(RoadmapEventSchema);
export const RoadmapEventCreateSchema = z.never();
export const RoadmapEventUpdateSchema = z.never();
