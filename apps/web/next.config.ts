import type { NextConfig } from "next";

import { imageSettings } from "./src/media-source";

const config: NextConfig = {
  // `@sebela/ui` ships TypeScript and CSS sources without a build step; Next compiles them.
  transpilePackages: ["@sebela/ui"],
  // No `X-Powered-By` header: it tells visitors nothing useful.
  poweredByHeader: false,
  // The image optimizer reads only stored images on the site's own `/media/` path, never another
  // host; the settings depend on no environment (src/media-source.ts).
  images: imageSettings(),
};

export default config;
