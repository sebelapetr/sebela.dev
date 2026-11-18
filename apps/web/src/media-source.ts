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

/** Characters an address may hide traversal or a second meaning behind. */
const UNSAFE = /[\\?#]|%(?:2e|2f|5c)/iu;

/**
 * Reads a media base address. Returns what is wrong with it (never repeating the value) unless it
 * is an http or https address without credentials, query or fragment whose path names at least one
 * plain folder.
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

/** An IPv6 address (as the URL parser writes it) as its eight numbers, or null. */
function ipv6Groups(address: string): number[] | null {
  const [head = "", tail, ...rest] = address.split("::");
  if (rest.length > 0) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  const start = parse(head);
  const end = tail === undefined ? [] : parse(tail);
  const zeros = tail === undefined ? 0 : 8 - start.length - end.length;
  const groups = [...start, ...Array<number>(Math.max(zeros, 0)).fill(0), ...end];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

/**
 * Whether a host is a loopback or private network address, which Next refuses by default. Only
 * addresses are recognised, not names: a local base names its host by address, as `API_HOST` does.
 */
function isLocalHost(hostname: string): boolean {
  if (hostname.startsWith("[")) {
    const groups = ipv6Groups(hostname.slice(1, -1).toLowerCase());
    if (groups === null) return false;
    const [first = 0] = groups;
    const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
    // Unique local addresses, fc00::/7.
    return loopback || (first & 0xfe00) === 0xfc00;
  }
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
export function imageSettings(env: Readonly<Record<string, string | undefined>>): ImageConfig {
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
