import { describe, expect, it } from "vitest";

import { cvPdfFilename, cvPdfResponse } from "./download-response";

const PDF_BYTES = Uint8Array.from(new TextEncoder().encode("%PDF-1.4\n% a fictional CV\n%%EOF\n"));

describe("cvPdfResponse", () => {
  it("serves the PDF's own bytes as a download that is never cached or sniffed", async () => {
    const response = cvPdfResponse({
      status: "ready",
      bytes: PDF_BYTES,
      personName: "Robin Example",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Length")).toBe(String(PDF_BYTES.byteLength));
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="robin-example-cv.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("sends a visitor to the live CV when there is no PDF", () => {
    const response = cvPdfResponse({ status: "none" });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/cv");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sends a visitor to the failure page, never a download, when the PDF is unavailable", () => {
    const response = cvPdfResponse({ status: "unavailable" });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/cv/pdf/unavailable");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("cvPdfFilename", () => {
  it("names the file after the person, in plain lower-case ASCII", () => {
    expect(cvPdfFilename("Robin Example")).toBe("robin-example-cv.pdf");
  });

  it("drops accents and anything that is not a letter or a digit", () => {
    expect(cvPdfFilename("Žofie Nováková-Šťastná, Ph.D.")).toBe(
      "zofie-novakova-stastna-ph-d-cv.pdf",
    );
  });

  it("falls back to a plain name when nothing usable is left", () => {
    expect(cvPdfFilename("   ")).toBe("cv.pdf");
    expect(cvPdfFilename("李雷")).toBe("cv.pdf");
  });
});
