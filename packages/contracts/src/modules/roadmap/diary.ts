// The learning diary contracts. Stubs until the implementation lands.
import { z } from "zod";

export const diaryTimeZone = "";
export const DiaryDateSchema = z.never();
export const DiaryDateParamsSchema = z.strictObject({ date: z.never() });
export const TimeEntryIdParamsSchema = z.strictObject({ id: z.never() });
export const TimeEntryCreateSchema = z.strictObject({
  resource: z.never(),
  startedAt: z.never(),
  endedAt: z.never(),
});
export const TimeEntryUpdateSchema = TimeEntryCreateSchema.partial();
export const DiaryNotesWriteSchema = z.strictObject({ notes: z.never() });
const ResourceStub = z.object({ area: z.never() });
export const TimeEntrySchema = z.object({ resource: ResourceStub });
export const DiaryDaySchema = z.object({ entries: z.array(TimeEntrySchema) });
export const DiarySchema = z.object({ days: z.array(DiaryDaySchema) });
export const TimeEntryWriteSchema = z.object({ dates: z.never() });
