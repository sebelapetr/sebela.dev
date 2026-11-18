// The attended events' HTTP routes, private to the roadmap module and part of its routes: public
// reads of every event and of one event, and authenticated create, update and delete. Attendance is
// logged through the time-entry routes with an `event` target; an event's dates alone add no time.
import {
  RoadmapEventCreateSchema,
  RoadmapEventListSchema,
  RoadmapEventSchema,
  RoadmapEventUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { RoadmapService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const EVENTS = "/v1/roadmap/events";
const EVENT = "/v1/roadmap/events/:slug";

const EVENT_RULES =
  "The dates are inclusive Europe/Prague calendar days; the end cannot be before the start " +
  "(`validation_failed` on `endsOn`) and equals it for a single-day event. Every slug in " +
  "`topics` names an existing topic, each once (`validation_failed` on `topics`). The event " +
  "shows on every diary day of its range without adding time.";

/** The routes of the attended events over the roadmap service. */
export function eventRoutes(roadmap: RoadmapService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listRoadmapEvents",
      method: "GET",
      path: EVENTS,
      access: "public",
      summary: "Read the attended events",
      description:
        "Every event, newest start first, with its topics and the attendance time logged on it, " +
        "derived from its time entries alone. No events is the valid empty list.",
      response: { status: 200, description: "The events.", schema: RoadmapEventListSchema },
      errors: [],
      handle: () => roadmap.listEvents(),
    }),
    defineRoute({
      operationId: "getRoadmapEvent",
      method: "GET",
      path: EVENT,
      access: "public",
      summary: "Read an event",
      params: SlugParamsSchema,
      response: { status: 200, description: "The event.", schema: RoadmapEventSchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getEvent(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapEvent",
      method: "POST",
      content: "roadmap-event",
      path: EVENTS,
      access: "private",
      summary: "Add an attended event",
      description:
        "The slug is unique and stable; a taken slug is a conflict. Omitted optional fields mean " +
        `none, in person and without topics. ${EVENT_RULES}`,
      body: RoadmapEventCreateSchema,
      response: {
        status: 201,
        description: "The created event.",
        schema: RoadmapEventSchema,
        location: EVENT,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createEvent(body),
    }),
    defineRoute({
      operationId: "updateRoadmapEvent",
      method: "PATCH",
      content: "roadmap-event",
      path: EVENT,
      access: "private",
      summary: "Update an event",
      description:
        "Changes only the fields sent; `null` clears an optional field, given `topics` replace " +
        `every link and the slug cannot change. ${EVENT_RULES} The period is judged with the ` +
        "stored dates. New dates that would leave logged attendance outside the event are " +
        "refused (`409`, naming those days) and nothing changes.",
      params: SlugParamsSchema,
      body: RoadmapEventUpdateSchema,
      response: { status: 200, description: "The updated event.", schema: RoadmapEventSchema },
      errors: ["not_found", "conflict"],
      handle: ({ params, body }) => roadmap.updateEvent(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapEvent",
      method: "DELETE",
      content: "roadmap-event",
      path: EVENT,
      access: "private",
      summary: "Delete an event",
      description:
        "An event with logged attendance is not deleted (`409`), so its history is never erased " +
        "silently; move or delete that time first. Its diary days without notes or time go with it.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The event was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await roadmap.deleteEvent(params.slug);
        return undefined;
      },
    }),
  ];
}
