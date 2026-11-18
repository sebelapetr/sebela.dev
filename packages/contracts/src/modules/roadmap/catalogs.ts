// The resource catalogs, private to the roadmap module and shared by its contracts.

/** Kinds of learning resource, the values of the original application. */
export const roadmapResourceTypes = [
  "youtube-video",
  "youtube-playlist",
  "google-drive",
  "video",
  "link",
  "text",
  "project",
  "book",
] as const;

/** Where a resource stands; `paused` and `skipped` are kept on the resource only. */
export const roadmapResourceStatuses = [
  "planned",
  "in-progress",
  "completed",
  "paused",
  "skipped",
] as const;
