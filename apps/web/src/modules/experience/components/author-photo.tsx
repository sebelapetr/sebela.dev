import { MediaImage } from "../../_shared";
import type { ImageMedia } from "../../profile";

/**
 * A testimonial author's photo: a 40 px circle on mobile and 48 px from `sm`, cropped to fill it,
 * on a `muted` background. Callers render it only when there is a photo; without one, or when its
 * file cannot be loaded, nothing takes its place.
 */
export function AuthorPhoto({ photo }: { readonly photo: ImageMedia }) {
  return (
    <MediaImage
      image={photo}
      sizes="(min-width: 640px) 48px, 40px"
      slot="author-photo"
      className="size-10 shrink-0 rounded-full bg-muted object-cover sm:size-12"
    />
  );
}
