import Image from "next/image";

import type { ImageMedia } from "../../profile";

/**
 * A testimonial author's photo: a 40 px circle on mobile and 48 px from `sm`, cropped to fill it,
 * on a `muted` background. Callers render it only when there is a photo; without one nothing takes
 * its place.
 */
export function AuthorPhoto({ photo }: { readonly photo: ImageMedia }) {
  return (
    <Image
      src={photo.url}
      alt={photo.altText}
      width={photo.width}
      height={photo.height}
      // Image optimisation and responsive variants arrive with the media slice (#55).
      unoptimized
      data-slot="author-photo"
      className="size-10 shrink-0 rounded-full bg-muted object-cover sm:size-12"
    />
  );
}
