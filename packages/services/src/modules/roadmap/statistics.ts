// The learning statistics, private to the roadmap module. The database aggregates every view in
// one consistent snapshot; this module only names each resource's category for the contract.
import type { RoadmapStatistics } from "@sebela/contracts";
import type { RoadmapPersistence } from "@sebela/db";

/**
 * The learning statistics over the diary's time entries, in whole seconds. Every entry counts
 * exactly once in each view as a resource, book (a resource of type `book`) or event entry, in its
 * Europe/Prague diary day, that day's Monday-start week and its month; the three categories sum to
 * the total of every period. Areas and modules hold study time through each resource's current
 * module, never event attendance. An empty diary gives zero totals and empty lists.
 */
export interface LearningStatistics {
  getStatistics(): Promise<RoadmapStatistics>;
}

export function createLearningStatistics(persistence: RoadmapPersistence): LearningStatistics {
  return {
    async getStatistics() {
      const statistics = await persistence.loadLearningStatistics();
      return {
        ...statistics,
        resources: statistics.resources.map((resource) => ({
          ...resource,
          category: resource.type === "book" ? "book" : "resource",
        })),
      };
    },
  };
}
