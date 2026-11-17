// The cv module: the CV page's template — the print-friendly, single-column CV assembled by the API,
// with the PDF's download and date — and the answer of the PDF's download route, which serves the
// current manually uploaded file or sends the visitor to the live CV or to the failure page.
export { CvTemplate } from "./templates/cv";
export { cvPdfResponse } from "./data/download-response";
