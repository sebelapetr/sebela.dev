// The bookshelf's HTTP routes, private to the roadmap module and part of its routes: public reads
// of every book and of one book, and authenticated create, update and delete. A book's status and
// reading time are derived on read; the resource of type `book` that links it carries the time.
import {
  RoadmapBookCreateSchema,
  RoadmapBookListSchema,
  RoadmapBookSchema,
  RoadmapBookUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { RoadmapService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const BOOKS = "/v1/roadmap/books";
const BOOK = "/v1/roadmap/books/:slug";

const COVER_RULE =
  "A `coverId` must name an uploaded image (`validation_failed` on `coverId` otherwise); the " +
  "end cannot be before the start (`validation_failed` on `endedOn`).";

/** The routes of the bookshelf over the roadmap service. */
export function bookRoutes(roadmap: RoadmapService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listRoadmapBooks",
      method: "GET",
      path: BOOKS,
      access: "public",
      summary: "Read the bookshelf",
      description:
        "Every book by ascending priority, then slug, with its cover, the status derived from its " +
        "dates, the resource of type `book` that links it and the time logged on that resource. " +
        "An empty bookshelf is the valid empty list.",
      response: { status: 200, description: "The books.", schema: RoadmapBookListSchema },
      errors: [],
      handle: () => roadmap.listBooks(),
    }),
    defineRoute({
      operationId: "getRoadmapBook",
      method: "GET",
      path: BOOK,
      access: "public",
      summary: "Read a book",
      params: SlugParamsSchema,
      response: { status: 200, description: "The book.", schema: RoadmapBookSchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getBook(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapBook",
      method: "POST",
      content: "roadmap-book",
      path: BOOKS,
      access: "private",
      summary: "Add a book to the bookshelf",
      description:
        "The slug is unique and stable; a taken slug is a conflict. Omitted optional fields mean " +
        `none and an omitted priority means \`0\`. ${COVER_RULE} A book is linked by giving its ` +
        "slug as the `book` of a resource of type `book`.",
      body: RoadmapBookCreateSchema,
      response: {
        status: 201,
        description: "The created book.",
        schema: RoadmapBookSchema,
        location: BOOK,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createBook(body),
    }),
    defineRoute({
      operationId: "updateRoadmapBook",
      method: "PATCH",
      content: "roadmap-book",
      path: BOOK,
      access: "private",
      summary: "Update a book",
      description:
        "Changes only the fields sent; `null` clears an optional field and the slug cannot " +
        `change. ${COVER_RULE} The period is judged with the stored dates.`,
      params: SlugParamsSchema,
      body: RoadmapBookUpdateSchema,
      response: { status: 200, description: "The updated book.", schema: RoadmapBookSchema },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateBook(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapBook",
      method: "DELETE",
      content: "roadmap-book",
      path: BOOK,
      access: "private",
      summary: "Delete a book",
      description:
        "A book that a resource still links is not deleted (`409`); clear the resource's `book` " +
        "first. The cover media stays.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The book was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await roadmap.deleteBook(params.slug);
        return undefined;
      },
    }),
  ];
}
