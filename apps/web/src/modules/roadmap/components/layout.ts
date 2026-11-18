// The roadmap timeline's geometry, shared by the client branch and the server-rendered resources
// and lists. It lives in a plain module: a server component importing a constant from a
// "use client" file gets a client reference instead of the string.

/** The roadmap's items on the shared timeline: the rail's place and the items' rhythm. */
export const ROADMAP_TIMELINE = "gap-0 sm:before:left-5";
/**
 * One roadmap item on the timeline; its text starts 36 px in on mobile and 56 px from `sm`, the
 * original roadmap's nesting step (a recorded exception to the spacing scale in docs/design.md).
 */
export const ROADMAP_ITEM = "pb-3 pl-9 sm:pl-14";
/** A roadmap item's marker, centred on the rail. */
export const ROADMAP_MARKER = "top-1 sm:left-1";
