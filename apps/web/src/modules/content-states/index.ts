// The content-states module: the pages shown instead of content — unavailable (the API could not
// be read), not found, the CV PDF that could not be downloaded, the AI Roadmap's placeholder
// until phase 4 and the chat's placeholder until the mock-chat slice. Importable from client
// components; no server-only code.
export { AskPlaceholderTemplate } from "./templates/ask-placeholder";
export { CvPdfUnavailableTemplate } from "./templates/cv-pdf-unavailable";
export { NotFoundTemplate } from "./templates/not-found";
export { RoadmapPlaceholderTemplate } from "./templates/roadmap-placeholder";
export { UnavailableTemplate } from "./templates/unavailable";
