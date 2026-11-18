"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

/** An image from the API's media, as the profile module reads it. */
export interface MediaImageSource {
  readonly url: string;
  readonly altText: string;
  readonly width: number;
  readonly height: number;
}

/**
 * An image from the API's media through Next's image optimizer: responsive WebP sources for the
 * widths `sizes` describes, the media's own dimensions (so the layout does not shift) and its alt
 * text. When the file cannot be loaded (the original is gone, the optimizer refuses or fails) the
 * image gives way to `fallback`, or to nothing, so a broken image is never shown. Next replays an
 * error that happened before hydration, so a file that is already missing falls back too.
 */
export function MediaImage({
  image,
  sizes,
  className,
  preload = false,
  slot,
  fallback = null,
}: {
  readonly image: MediaImageSource;
  readonly sizes: string;
  readonly className: string;
  readonly preload?: boolean;
  readonly slot?: string;
  readonly fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <Image
      src={image.url}
      alt={image.altText}
      width={image.width}
      height={image.height}
      sizes={sizes}
      preload={preload}
      data-slot={slot}
      className={className}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
