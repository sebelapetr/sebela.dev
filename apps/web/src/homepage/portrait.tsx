import Image from "next/image";

import type { HomepagePhoto } from "../profile";

/** Up to two initials of a name, for the placeholder shown without a photo. */
function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join("");
}

/**
 * The person's photo at its own aspect ratio and a fixed width per breakpoint; without a photo a
 * neutral placeholder of the same shape with the person's initials, hidden from assistive
 * technology because the name is next to it.
 */
export function Portrait({
  photo,
  name,
}: {
  readonly photo: HomepagePhoto | null;
  readonly name: string;
}) {
  const frame = "w-40 sm:w-48 md:w-56 lg:w-80";
  if (photo === null) {
    return (
      <div
        aria-hidden="true"
        data-testid="portrait-fallback"
        className={`${frame} flex aspect-[4/5] items-center justify-center rounded-xl bg-muted font-mono text-3xl text-muted-foreground`}
      >
        {initials(name)}
      </div>
    );
  }
  return (
    <Image
      src={photo.url}
      alt={photo.altText}
      width={photo.width}
      height={photo.height}
      // Image optimisation and responsive variants arrive with the media slice (#55).
      unoptimized
      preload
      sizes="(min-width: 1024px) 20rem, (min-width: 768px) 14rem, 12rem"
      className={`${frame} h-auto rounded-xl bg-muted object-cover`}
    />
  );
}
