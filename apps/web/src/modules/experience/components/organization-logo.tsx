import Image from "next/image";

import type { ImageMedia } from "../../profile";

/**
 * An organization's logo at its own aspect ratio: 24 px tall on mobile and 32 px from `sm`, at
 * most 128 / 160 px wide, aligned to the start of the line. Callers render it only when there is
 * a logo; without one nothing takes its place.
 */
export function OrganizationLogo({ logo }: { readonly logo: ImageMedia }) {
  return (
    <Image
      src={logo.url}
      alt={logo.altText}
      width={logo.width}
      height={logo.height}
      // Image optimisation and responsive variants arrive with the media slice (#55).
      unoptimized
      data-slot="organization-logo"
      className="h-6 w-auto max-w-32 object-contain object-left sm:h-8 sm:max-w-40"
    />
  );
}
