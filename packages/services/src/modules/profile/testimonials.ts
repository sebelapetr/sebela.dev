import type { TestimonialService } from "./types.js";

const missing = () => Promise.reject(new Error("Testimonials are not implemented yet."));

/** Not implemented yet. */
export function createTestimonialService(): TestimonialService {
  return {
    listTestimonials: missing,
    getTestimonial: missing,
    createTestimonial: missing,
    updateTestimonial: missing,
    deleteTestimonial: missing,
  };
}
