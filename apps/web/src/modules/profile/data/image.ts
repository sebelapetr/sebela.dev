import type { ApiClient, Media } from "@sebela/api-client";

/** An image from the API's media, ready for an image element. */
export interface ImageMedia {
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
 * not an image, no web address, no dimensions, or a read that failed, was refused or timed out.
 * Never throws, so a missing image never takes the page down with it.
 */
export async function readImage(
  client: ApiClient,
  id: string,
  init: ReadInit,
): Promise<ImageMedia | null> {
  try {
    const { data } = await client.GET("/v1/media/{id}", { params: { path: { id } }, ...init });
    return data === undefined ? null : toImage(data);
  } catch {
    return null;
  }
}

function toImage(media: Media): ImageMedia | null {
  if (!media.mediaType.startsWith("image/")) return null;
  if (media.url === null || !isWebUrl(media.url)) return null;
  if (media.width === null || media.height === null) return null;
  return {
    url: media.url,
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
