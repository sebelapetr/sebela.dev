import type { Testimonial } from "@sebela/contracts";
import type {
  ProfilePersistence,
  TestimonialFields,
  TestimonialRecord,
  TestimonialRelations,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { definedChanges } from "./changes.js";
import type { TestimonialService } from "./types.js";

const missing = (slug: string) =>
  new DomainError("not_found", `There is no testimonial "${slug}".`);

/** A stored testimonial in the contract shape; the experience stays its slug. */
export function toTestimonial(record: TestimonialRecord): Testimonial {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A missing experience as a `validation_failed` naming `experience`. */
function unknownExperience(experience: string | undefined): DomainError {
  const message = `There is no experience "${experience ?? ""}"; create it first.`;
  return new DomainError("validation_failed", message, [{ path: "experience", message }]);
}

/**
 * The testimonials, each belonging to exactly one experience. Persistence judges the experience
 * and slug uniqueness on stored rows inside one transaction, so a refused write leaves nothing
 * behind.
 */
export function createTestimonialService(persistence: ProfilePersistence): TestimonialService {
  return {
    async listTestimonials() {
      return (await persistence.listTestimonials()).map(toTestimonial);
    },
    async getTestimonial(slug) {
      const record = await persistence.findTestimonial(slug);
      if (!record) throw missing(slug);
      return toTestimonial(record);
    },
    async createTestimonial(input) {
      const result = await persistence.createTestimonial(input);
      if (result.ok) return toTestimonial(result.testimonial);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `A testimonial "${input.slug}" already exists.`);
      }
      throw unknownExperience(input.experience);
    },
    async updateTestimonial(slug, changes) {
      const result = await persistence.updateTestimonial(
        slug,
        definedChanges<TestimonialFields & TestimonialRelations>(changes),
      );
      if (result.ok) return toTestimonial(result.testimonial);
      if (result.reason === "not_found") throw missing(slug);
      throw unknownExperience(changes.experience);
    },
    async deleteTestimonial(slug) {
      const result = await persistence.deleteTestimonial(slug);
      if (!result.ok) throw missing(slug);
    },
  };
}
