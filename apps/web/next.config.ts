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
  // The website image (apps/web/Dockerfile) builds a self-contained server with only the files it
  // traces; a build on the host keeps the output `next start` serves. A build switch, no setting.
  ...(process.env["WEB_BUILD_STANDALONE"] === "1" ? { output: "standalone" as const } : {}),
};

export default config;
