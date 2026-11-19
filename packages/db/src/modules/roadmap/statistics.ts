// The learning statistics, private to the roadmap module.
import type { Database } from "../../database.js";
import type { RoadmapPersistence } from "./types.js";

type StatisticsPersistence = Pick<RoadmapPersistence, "loadLearningStatistics">;

/** The statistics read over one connection or transaction. */
export function createStatisticsPersistence(db: Database): StatisticsPersistence {
  return {
    loadLearningStatistics() {
      return db.transaction(
        () => Promise.reject(new Error("The learning statistics are not implemented.")),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
