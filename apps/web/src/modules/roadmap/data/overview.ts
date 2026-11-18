import type {
  Roadmap,
  RoadmapDerivedStatus,
  RoadmapResourceStatus,
  RoadmapResourceType,
} from "@sebela/api-client";

export interface RoadmapFacts {
  readonly areaCount: number;
  readonly moduleCount: number;
  readonly resourceCount: number;
  readonly estimatedHours: number;
  readonly lastUpdated: string | null;
}

export interface ResourceRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: RoadmapResourceType;
  readonly typeLabel: string;
  readonly status: RoadmapResourceStatus;
  readonly estimate: string | null;
  readonly href: string | null;
}

export interface ModuleRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly order: string;
  readonly estimate: string | null;
  readonly completed: number;
  readonly total: number;
  readonly status: RoadmapDerivedStatus;
  readonly resources: readonly ResourceRow[];
}

export interface AreaRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly order: string;
  readonly href: string;
  readonly weight: number;
  readonly weightLevel: 1 | 2 | 3;
  readonly weightLabel: string;
  readonly completed: number;
  readonly total: number;
  readonly status: RoadmapDerivedStatus;
  readonly current: boolean;
  readonly modules: readonly ModuleRow[];
}

export interface RoadmapOverview {
  readonly facts: RoadmapFacts;
  readonly start: { readonly name: string; readonly href: string } | null;
  readonly areas: readonly AreaRow[];
}

/** Not implemented yet: the tests specify it first. */
function todo(...inputs: unknown[]): never {
  throw new Error(`not implemented: ${JSON.stringify(inputs)}`);
}

export function toRoadmapOverview(roadmap: Roadmap): RoadmapOverview {
  return todo(roadmap);
}
export function estimateLabel(minutes: number): string {
  return todo(minutes);
}
export function romanNumeral(value: number): string {
  return todo(value);
}
export function weightLevel(weight: number): 1 | 2 | 3 {
  return todo(weight);
}
export function weightLabel(weight: number): string {
  return todo(weight);
}
export function formatLastUpdated(iso: string): string {
  return todo(iso);
}
export function resourceTypeLabel(type: RoadmapResourceType): string {
  return todo(type);
}
export function safeLink(link: string | null): string | null {
  return todo(link);
}
