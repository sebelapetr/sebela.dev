import type { Person, Service } from "@sebela/api-client";

export type ServiceEvidenceItem =
  | {
      readonly kind: "project";
      readonly key: string;
      readonly name: string;
      readonly href: string;
    }
  | {
      readonly kind: "exploration";
      readonly key: string;
      readonly name: string;
      readonly href: string;
      readonly statusLabel: string;
      readonly statusMeaning: string;
    }
  | { readonly kind: "link"; readonly key: string; readonly label: string; readonly href: string };

export interface ServiceRow {
  readonly number: string;
  readonly slug: string;
  readonly anchor: string;
  readonly name: string;
  readonly summary: string;
  readonly audience: string;
  readonly deliverable: string;
  readonly evidence: readonly ServiceEvidenceItem[];
  readonly planned: readonly Extract<ServiceEvidenceItem, { kind: "exploration" }>[];
}

export interface CollaborationStepRow {
  readonly number: string;
  readonly title: string;
  readonly description: string;
}

export function toServiceRows(services: readonly Service[]): ServiceRow[] {
  throw new Error(`not implemented: ${String(Boolean(services))}`);
}

export function toCollaborationSteps(
  steps: readonly Person["collaborationSteps"][number][],
): CollaborationStepRow[] {
  throw new Error(`not implemented: ${String(Boolean(steps))}`);
}
