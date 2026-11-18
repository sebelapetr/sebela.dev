import { MediaImage } from "../../_shared";
import type { ImageMedia } from "../../profile";

/**
 * An organization's logo at its own aspect ratio: 24 px tall on mobile and 32 px from `sm`, at
 * most 128 / 160 px wide, aligned to the start of the line. Callers render it only when there is
 * a logo; without one, or when its file cannot be loaded, nothing takes its place.
 */
export function OrganizationLogo({ logo }: { readonly logo: ImageMedia }) {
  // The width it renders at, from its own aspect ratio, so no wider source is fetched than needed.
  const width = (height: number, max: number) =>
    Math.min(max, Math.ceil((height * logo.width) / logo.height));
  return (
    <MediaImage
      image={logo}
      sizes={`(min-width: 640px) ${String(width(32, 160))}px, ${String(width(24, 128))}px`}
      slot="organization-logo"
      className="h-6 w-auto max-w-32 object-contain object-left sm:h-8 sm:max-w-40"
    />
  );
}
