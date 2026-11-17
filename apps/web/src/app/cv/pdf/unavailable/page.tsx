import type { Metadata } from "next";

import { CvPdfUnavailableTemplate } from "../../../../modules/content-states";

export const metadata: Metadata = {
  title: "CV PDF unavailable",
  robots: { index: false },
};

export default function CvPdfUnavailablePage() {
  return <CvPdfUnavailableTemplate />;
}
