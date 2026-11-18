// The learning diary's persistence, private to the roadmap module. Stubs until it lands.
import type { RoadmapPersistence } from "./types.js";

type DiaryPersistence = Pick<
  RoadmapPersistence,
  | "loadDiary"
  | "findDiaryDay"
  | "writeDiaryNotes"
  | "clearDiaryNotes"
  | "findTimeEntry"
  | "createTimeEntries"
  | "replaceTimeEntry"
  | "deleteTimeEntry"
>;

const missing = () => Promise.reject(new Error("Not implemented."));

export function createDiaryPersistence(): DiaryPersistence {
  return {
    loadDiary: missing,
    findDiaryDay: missing,
    writeDiaryNotes: missing,
    clearDiaryNotes: missing,
    findTimeEntry: missing,
    createTimeEntries: missing,
    replaceTimeEntry: missing,
    deleteTimeEntry: missing,
  };
}
