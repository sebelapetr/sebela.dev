import { cvPdfRoutes, routes } from "../../_shared";
import type { CvPdfFile } from "../../profile";

/**
 * The answer to a request for the CV PDF: the stored file's own bytes as a download, a redirect to
 * the live CV when there is no PDF, or a redirect to the failure page when the PDF cannot be
 * delivered — never a download that is not the PDF. Nothing is cached: the next request sees the
 * file the person names now.
 */
export function cvPdfResponse(file: CvPdfFile): Response {
  switch (file.status) {
    case "ready":
      return new Response(file.bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(file.bytes.byteLength),
          "Content-Disposition": `attachment; filename="${cvPdfFilename(file.personName)}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    case "none":
      return redirect(routes.cv);
    case "unavailable":
      return redirect(cvPdfRoutes.unavailable);
  }
}

/**
 * The downloaded file's name, after the person: lower-case ASCII letters and digits joined by
 * hyphens, for example `robin-example-cv.pdf`; `cv.pdf` when nothing usable is left.
 */
export function cvPdfFilename(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "cv.pdf" : `${slug}-cv.pdf`;
}

// A relative Location: the browser resolves it against the address it asked, whatever host or
// proxy served it, so no host is assumed here.
function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}
