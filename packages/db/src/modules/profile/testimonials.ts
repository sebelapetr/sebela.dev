import type { TestimonialPersistence } from "./types.js";

const missing = () => Promise.reject(new Error("Testimonials are not implemented yet."));

/** Not implemented yet. */
export function createTestimonialPersistence(): TestimonialPersistence {
  return {
    listTestimonials: missing,
    findTestimonial: missing,
    createTestimonial: missing,
    updateTestimonial: missing,
    deleteTestimonial: missing,
  };
}
