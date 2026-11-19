// The learning statistics contract, private to the roadmap module and re-exported by its entry.
import { z } from "zod";

/** Not implemented yet. */
export const RoadmapStatisticsSchema = z.never().meta({ id: "RoadmapStatistics" });

export type RoadmapStatistics = z.infer<typeof RoadmapStatisticsSchema>;
