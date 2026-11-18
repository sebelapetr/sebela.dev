// Where the website's images may come from. The media base (`WEB_MEDIA_BASE_URL`) names the
// storage's public address with its environment folder and, in a worktree, its worktree folder;
// the image optimizer and the profile's media reads accept only an image file directly below it.
// Nothing here reads a visitor's input as a source: the optimizer refuses every other address.
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

/** A stored image's file name: the storage generates `<uuid>.<png|jpg|webp>`. */
const IMAGE_FILE = /^[A-Za-z0-9-]+\.(?:png|jpg|webp)$/u;

/** The same file name as a glob for Next's `remotePatterns`, which matches it with picomatch. */
const IMAGE_FILE_GLOB = "+([A-Za-z0-9-]).@(png|jpg|webp)";

/**
 * A host as the URL parser writes it, made of plain labels (a name or an IPv4 address). Next reads
 * a remote pattern's host as a glob, so brackets, stars and the like would match other hosts; an
 * IPv6 host, written in brackets, is refused for the same reason.
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
 * Whether `url` is an image file directly below the media base `base`: an absolute address on the
 * same protocol, host and port, without credentials, query, fragment or escaped separators.
 */
export function isMediaUrl(url: string, base: string): boolean {
  const media = parseMediaBase(base);
  if (typeof media === "string" || UNSAFE.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.protocol !== `${media.protocol}:`) return false;
  if (parsed.hostname !== media.hostname || parsed.port !== media.port) return false;
  // Compare the address as written: the parser would quietly resolve `..` away.
  const prefix = `${media.href}/`;
  if (!url.startsWith(prefix)) return false;
  const name = url.slice(prefix.length);
  return IMAGE_FILE.test(name) && parsed.pathname === `${media.path}/${name}`;
}

/**
 * Whether a host is a loopback or private IPv4 address, which Next refuses by default. Only
 * addresses are recognised, not names: a local base names its host by address, as `API_HOST` does.
 */
function isLocalHost(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const [a = -1, b = -1] = octets;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The image optimizer's settings for an environment such as `process.env`: it fetches only image
 * files directly below `WEB_MEDIA_BASE_URL`, without a query and without following a redirect, and
 * nothing at all when the variable is missing or invalid (the pages then refuse to start through
 * `readWebConfig`). Private addresses are allowed only when the base itself is one, as in a local
 * development or test run. One quality, WebP only and the widths the site renders.
 */
export function imageSettings(env: Readonly<Record<string, string | undefined>> = {}): ImageConfig {
  const value = env["WEB_MEDIA_BASE_URL"];
  const media = value === undefined ? "missing" : parseMediaBase(value);
  const valid = typeof media !== "string";
  return {
    remotePatterns: valid
      ? [
          {
            protocol: media.protocol,
            hostname: media.hostname,
            port: media.port,
            pathname: `${media.path}/${IMAGE_FILE_GLOB}`,
            search: "",
          },
        ]
      : [],
    localPatterns: [],
    maximumRedirects: 0,
    dangerouslyAllowLocalIP: valid && isLocalHost(media.hostname),
    formats: ["image/webp"],
    qualities: [75],
    // The portrait is at most 360 CSS px wide, a logo 160 and an author photo 48, so two device
    // pixels per CSS pixel need no source wider than 750.
    deviceSizes: [360, 480, 640, 750],
    imageSizes: [48, 64, 96, 128, 160, 256, 320],
  };
}

export function mediaFileName(url: string, base: string): string | null {
  throw new Error(`not implemented: ${url} ${base}`);
}

export function isImageFileName(name: string): boolean {
  throw new Error(`not implemented: ${name}`);
}

export function mediaPath(name: string): string {
  throw new Error(`not implemented: ${name}`);
}
