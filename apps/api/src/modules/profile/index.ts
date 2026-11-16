import { PersonCreateSchema, PersonSchema, PersonUpdateSchema } from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const PATH = "/v1/person";

/**
 * The HTTP routes of the person, the singleton profile record at a stable address: public read,
 * authenticated create, update and delete. Domain errors become `not_found` and `conflict`.
 */
export function profileRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getPerson",
      method: "GET",
      path: PATH,
      access: "public",
      summary: "Read the person",
      response: { status: 200, description: "The person.", schema: PersonSchema },
      errors: ["not_found"],
      handle: () => profile.getPerson(),
    }),
    defineRoute({
      operationId: "createPerson",
      method: "POST",
      path: PATH,
      access: "private",
      summary: "Create the person",
      description: "There is at most one person; a second create is a conflict.",
      body: PersonCreateSchema,
      response: {
        status: 201,
        description: "The created person.",
        schema: PersonSchema,
        location: PATH,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createPerson(body),
    }),
    defineRoute({
      operationId: "updatePerson",
      method: "PATCH",
      path: PATH,
      access: "private",
      summary: "Update the person",
      description: "Changes only the fields sent; `null` clears an optional field.",
      body: PersonUpdateSchema,
      response: { status: 200, description: "The updated person.", schema: PersonSchema },
      errors: ["not_found"],
      handle: ({ body }) => profile.updatePerson(body),
    }),
    defineRoute({
      operationId: "deletePerson",
      method: "DELETE",
      path: PATH,
      access: "private",
      summary: "Delete the person",
      response: { status: 204, description: "The person was deleted." },
      errors: ["not_found"],
      handle: async () => {
        await profile.deletePerson();
        return undefined;
      },
    }),
  ];
}
