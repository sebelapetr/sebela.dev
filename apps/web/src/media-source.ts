// Where the website's images come from. The media base (`WEB_MEDIA_BASE_URL`) names the storage's
// public address with its environment folder and, in a worktree, its worktree folder; only a
// stored file directly below it is used. The website serves a stored image from its own path
// `/media/<file>` (src/app/media/[file]/route.ts), and the image optimizer reads only that path,
// so it never fetches another host and the server can read the files at an internal address
// (`WEB_MEDIA_READ_BASE_URL`) that never reaches a page.
//
// Plain TypeScript without dependencies, because `next.config.ts` loads it when the server starts.
import type { NextConfig } from "next";

type ImageConfig = NonNullable<NextConfig["images"]>;

/** A validated media base: its address without a trailing slash and its parts. */
export interface MediaBase {
  readonly href: string;
  readonly protocol: "http" | "https";
  readonly hostname: string;
  readonly port: string;
  /** The base's path without a trailing slash, never empty. */
  readonly path: string;
}

/** A folder of the base's path: letters, digits, `_` and `-`, so it is never a glob or an escape. */
const BASE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

/** A stored file's name: the storage generates `<uuid>.<png|jpg|webp|pdf>`. */
const STORED_FILE = /^[A-Za-z0-9-]+\.(?:png|jpg|webp|pdf)$/u;

/** A stored image's file name. */
const IMAGE_FILE = /^[A-Za-z0-9-]+\.(?:png|jpg|webp)$/u;

/** The site's own path the stored images are served from. */
const MEDIA_PATH = "/media";

/** The image file name as a glob for Next's `localPatterns`, which matches it with picomatch. */
const IMAGE_FILE_GLOB = "+([A-Za-z0-9-]).@(png|jpg|webp)";

/**
 * A host as the URL parser writes it, made of plain labels (a name or an IPv4 address); an IPv6
 * host, written in brackets, is refused, so a base compares by plain string.
 */
const PLAIN_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u;

/** Characters an address may hide traversal or a second meaning behind. */
const UNSAFE = /[\\?#]|%(?:2e|2f|5c)/iu;

/**
 * Reads a media base address. Returns what is wrong with it (never repeating the value) unless it
 * is an http or https address without credentials, query or fragment, with a plain host name or IPv4
 * address, whose path names at least one plain folder.
 */
export function parseMediaBase(value: string): MediaBase | string {
  if (UNSAFE.test(value)) return "must not have a query, a fragment or an escaped path";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an http or https address";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "must be an http or https address";
  }
  if (url.username !== "" || url.password !== "") return "must not contain credentials";
  if (!PLAIN_HOST.test(url.hostname)) return "must name its host by a plain name or IPv4 address";
  const segments = url.pathname.replace(/\/+$/u, "").split("/").slice(1);
  if (segments.length === 0 || !segments.every((segment) => BASE_SEGMENT.test(segment))) {
    return "must name the storage's environment folder with plain folder names";
  }
  // The parser removes dot segments; a base that had any is refused rather than reinterpreted.
  if (!value.replace(/\/+$/u, "").endsWith(`/${segments.join("/")}`)) {
    return "must name the storage's environment folder with plain folder names";
  }
  const path = `/${segments.join("/")}`;
  return {
    href: `${url.origin}${path}`,
    protocol: url.protocol === "https:" ? "https" : "http",
    hostname: url.hostname,
    port: url.port,
    path,
  };
}

/**
 * The name of the stored file `url` addresses directly below the media base `base`, or null unless
 * it is an absolute address on the same protocol, host and port, without credentials, query,
 * fragment or escaped separators, naming a `<name>.<png|jpg|webp|pdf>` the storage writes.
 */
export function mediaFileName(url: string, base: string): string | null {
  const media = parseMediaBase(base);
  if (typeof media === "string" || UNSAFE.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.protocol !== `${media.protocol}:`) return null;
  if (parsed.hostname !== media.hostname || parsed.port !== media.port) return null;
  // Compare the address as written: the parser would quietly resolve `..` away.
  const prefix = `${media.href}/`;
  if (!url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length);
  return STORED_FILE.test(name) && parsed.pathname === `${media.path}/${name}` ? name : null;
}

/** Whether `name` is a stored image's file name: `<name>.<png|jpg|webp>`, nothing more. */
export function isImageFileName(name: string): boolean {
  return IMAGE_FILE.test(name);
}

/** The site's own path a stored image `name` is served from. */
export function mediaPath(name: string): string {
  return `${MEDIA_PATH}/${name}`;
}

/**
 * The image optimizer's settings: it reads only stored images on the site's own media path, without
 * a query and without following a redirect, and no other host at all. They depend on no setting,
 * so the build and every environment agree. One quality, WebP only and the widths the site renders.
 */
export function imageSettings(): ImageConfig {
  return {
    remotePatterns: [],
    localPatterns: [{ pathname: `${MEDIA_PATH}/${IMAGE_FILE_GLOB}`, search: "" }],
    maximumRedirects: 0,
    dangerouslyAllowLocalIP: false,
    formats: ["image/webp"],
    qualities: [75],
    // The portrait is at most 360 CSS px wide, a logo 160 and an author photo 48, so two device
    // pixels per CSS pixel need no source wider than 750.
    deviceSizes: [360, 480, 640, 750],
    imageSizes: [48, 64, 96, 128, 160, 256, 320],
  };
}
