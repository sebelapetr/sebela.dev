import type { NextConfig } from "next";

type ImageConfig = NonNullable<NextConfig["images"]>;

export function isMediaUrl(url: string, base: string): boolean {
  throw new Error(`Not implemented: ${url} ${base}`);
}

export function imageSettings(env: Readonly<Record<string, string | undefined>>): ImageConfig {
  throw new Error(`Not implemented: ${String(Object.keys(env).length)}`);
}
