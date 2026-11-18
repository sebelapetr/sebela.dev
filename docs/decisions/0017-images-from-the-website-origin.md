# 0017 — The website serves stored images from its own origin

Status: accepted
Date: 2026-11-18

## Decision

Pages name a stored image by the website's own path `/media/<file>`, never by the storage's address. A route handler (`apps/web/src/app/media/[file]/route.ts`) reads the image file of that name directly below the media base (`WEB_MEDIA_BASE_URL`), or below a separate server-side read address (`WEB_MEDIA_READ_BASE_URL`) when one is set, and serves it with its own type, `nosniff` and a policy that loads nothing. Next's image optimizer reads only that path: `images.localPatterns` for one file name without a query, no `remotePatterns`, no redirects. The CV PDF download reads its file through the same read address. The details are in `apps/web/AGENTS.md`, "Media and previews" and "Container".

## Why

- In the container stack the website's server reaches the API by its Compose service name, which a browser can neither resolve nor should see. The published media address the API names is reachable for browsers but not necessarily from inside the container. A server-side read address that never reaches a page separates the two.
- With `remotePatterns`, the optimizer's allowed host was taken from `WEB_MEDIA_BASE_URL` when the server started. The settings depended on the environment, and pointing them at an internal address would have let it into the page markup. Settings that depend on no environment let the same image serve any environment.
- Next resolves a local `src` of the optimizer through the app's own route handlers, so the optimizer keeps its resizing, WebP output and cache while it never fetches another host.
- Rewrites to the storage were rejected because Next fixes them at build time, while the image is built without any setting.

## Rejected

- **The internal API address in `remotePatterns`.** Pages would name an address browsers cannot load.
- **Next rewrites from `/media/` to the storage.** Fixed when the image is built; the image must not depend on the environment.
- **Building one image per environment.** The image would carry configuration, and the build would need settings it is meant to work without.
