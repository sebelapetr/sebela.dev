import type { NextConfig } from "next";

import { imageSettings } from "./src/media-source";

const config: NextConfig = {
  // `@sebela/ui` ships TypeScript and CSS sources without a build step; Next compiles them.
  transpilePackages: ["@sebela/ui"],
  // No `X-Powered-By` header: it tells visitors nothing useful.
  poweredByHeader: false,
  // The image optimizer fetches only image files directly below `WEB_MEDIA_BASE_URL`; the
  // settings are read when the server starts (src/media-source.ts).
  images: imageSettings(process.env),
};

export default config;
