// The learning statistics, private to the roadmap module.
import type { RoadmapStatistics } from "@sebela/contracts";
import type { RoadmapPersistence } from "@sebela/db";

/** The learning statistics over the diary's time entries. */
export interface LearningStatistics {
  getStatistics(): Promise<RoadmapStatistics>;
}

export function createLearningStatistics(persistence: RoadmapPersistence): LearningStatistics {
  return {
    async getStatistics() {
      await persistence.loadLearningStatistics();
      throw new Error("The learning statistics are not implemented.");
    },
  };
}
