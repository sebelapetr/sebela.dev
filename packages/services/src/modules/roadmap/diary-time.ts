// Diary time arithmetic, private to the roadmap module: which Prague calendar day an instant
// belongs to, where a session is split at local midnight, and elapsed seconds.

/** An interval between two absolute instants. */
export interface Interval {
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** One piece of a session within one diary day. */
export interface DiaryPiece extends Interval {
  readonly date: string;
}

const notYet = (): never => {
  throw new Error("Not implemented.");
};

/** The Prague calendar date of the instant, `YYYY-MM-DD`. */
export const diaryDateOf: (instant: Date) => string = notYet;

/** The session split at each Prague midnight it crosses, in order. */
export const splitIntoDiaryDays: (startedAt: Date, endedAt: Date) => DiaryPiece[] = notYet;

/** The actual elapsed seconds of the interval. */
export const elapsedSeconds: (interval: Interval) => number = notYet;

/** The sum of the intervals' elapsed seconds. */
export const totalSeconds: (intervals: readonly Interval[]) => number = notYet;
