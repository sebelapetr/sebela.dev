import {
  BookOpen,
  CodeXml,
  FileText,
  Folder,
  Link,
  ListVideo,
  Play,
  SquarePlay,
  type LucideIcon,
} from "lucide-react";

import type { RoadmapResourceType } from "@sebela/api-client";

const ICONS: Readonly<Record<RoadmapResourceType, LucideIcon>> = {
  "youtube-video": SquarePlay,
  "youtube-playlist": ListVideo,
  video: Play,
  "google-drive": Folder,
  link: Link,
  project: CodeXml,
  book: BookOpen,
  text: FileText,
};

/** A resource's type as a 16 px icon in its marker; decorative, its type badge says the same. */
export function ResourceIcon({ type }: { readonly type: RoadmapResourceType }) {
  const Icon = ICONS[type];
  return <Icon aria-hidden="true" className="size-4" />;
}
