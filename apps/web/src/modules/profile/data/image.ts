import type { ApiClient, Media } from "@sebela/api-client";

import { isImageFileName, mediaFileName, mediaPath } from "../../../media-source";

/** An image from the API's media, ready for an image element. */
export interface ImageMedia {
  /** The site's own path the image is served from, `/media/<file>`. */
  readonly url: string;
  /** The media's alternative text; empty when the media has none. */
  readonly altText: string;
  readonly width: number;
  readonly height: number;
}

export interface ReadInit {
  readonly cache: "no-store";
  readonly signal: AbortSignal;
}

/**
 * Reads one media item from the public media route as an image, or null when it cannot be shown:
 * not an image, no image file directly below the configured media base `mediaBaseUrl`, no
 * dimensions, or a read that failed, was refused or timed out. The image's address is the site's
 * own media path, which serves the same file (the only images the image optimizer reads).
 * Never throws, so a missing image never takes the page down with it.
 */
export async function readImage(
  client: ApiClient,
  id: string,
  init: ReadInit,
  mediaBaseUrl: string,
): Promise<ImageMedia | null> {
  try {
    const { data } = await client.GET("/v1/media/{id}", { params: { path: { id } }, ...init });
    return data === undefined ? null : imageFromMedia(data, mediaBaseUrl);
  } catch {
    return null;
  }
}

/**
 * A media item the API already answered as the site's image, or null when it cannot be shown: not
 * an image, no image file directly below the media base `mediaBaseUrl`, or no dimensions.
 */
export function imageFromMedia(media: Media, mediaBaseUrl: string): ImageMedia | null {
  if (!media.mediaType.startsWith("image/")) return null;
  const name = media.url === null ? null : mediaFileName(media.url, mediaBaseUrl);
  if (name === null || !isImageFileName(name)) return null;
  if (media.width === null || media.height === null) return null;
  return {
    url: mediaPath(name),
    altText: media.altText ?? "",
    width: media.width,
    height: media.height,
  };
}

/** Whether a value is an http or https address. */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
