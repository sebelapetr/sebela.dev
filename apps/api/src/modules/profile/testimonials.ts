import {
  SlugParamsSchema,
  TestimonialCreateSchema,
  TestimonialListSchema,
  TestimonialSchema,
  TestimonialUpdateSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/testimonials";
const ITEM = "/v1/testimonials/:slug";

/**
 * The HTTP routes of the testimonials, addressed by stable slug: public list and read,
 * authenticated create, update and delete. Every testimonial belongs to exactly one experience,
 * named by slug, and may carry an optional author photo, `authorPhotoId`, naming uploaded image
 * media. An unknown experience, unknown or non-image media or bounded text out of range is a
 * `validation_failed` naming the field, and a taken slug is a `conflict`. Nothing refers to a testimonial, so a delete
 * never conflicts; the experience it belongs to cannot be deleted while it exists.
 */
export function testimonialRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listTestimonials",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the testimonials",
      description:
        "Quotes from clients and colleagues, grouped by experience in the experience order, then by position and slug. Each names the experience it belongs to.",
      response: {
        status: 200,
        description: "Every testimonial, in order.",
        schema: TestimonialListSchema,
      },
      errors: [],
      handle: () => profile.listTestimonials(),
    }),
    defineRoute({
      operationId: "getTestimonial",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read a testimonial",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The testimonial.",
        schema: TestimonialSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getTestimonial(params.slug),
    }),
    defineRoute({
      operationId: "createTestimonial",
      method: "POST",
      content: "testimonial",
      path: LIST,
      access: "private",
      summary: "Create a testimonial",
      description:
        "The testimonial belongs to the existing experience named by `experience`; an unknown experience is refused with that field. The slug is unique and stable; a taken slug is a conflict. `authorPhotoId` attaches uploaded image media as the author photo; a PDF or unknown media is refused.",
      body: TestimonialCreateSchema,
      response: {
        status: 201,
        description: "The created testimonial.",
        schema: TestimonialSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createTestimonial(body),
    }),
    defineRoute({
      operationId: "updateTestimonial",
      method: "PATCH",
      content: "testimonial",
      path: ITEM,
      access: "private",
      summary: "Update a testimonial",
      description:
        "Changes only the fields sent; `null` clears the author photo; the slug cannot change. A sent `experience` moves the testimonial to that existing experience; an unknown one is refused and changes nothing.",
      params: SlugParamsSchema,
      body: TestimonialUpdateSchema,
      response: {
        status: 200,
        description: "The updated testimonial.",
        schema: TestimonialSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateTestimonial(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteTestimonial",
      method: "DELETE",
      content: "testimonial",
      path: ITEM,
      access: "private",
      summary: "Delete a testimonial",
      description: "Removes the testimonial; its experience and its author photo stay.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The testimonial was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await profile.deleteTestimonial(params.slug);
        return undefined;
      },
    }),
  ];
}
