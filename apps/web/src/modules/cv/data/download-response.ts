import type { CvPdfFile } from "../../profile";

const notImplemented = (): never => {
  throw new Error("Not implemented.");
};

export const cvPdfResponse: (file: CvPdfFile) => Response = notImplemented;

export const cvPdfFilename: (name: string) => string = notImplemented;
