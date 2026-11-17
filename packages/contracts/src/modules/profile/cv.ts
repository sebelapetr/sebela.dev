import { z } from "zod";

import { MediaSchema } from "../media/index.js";
import { EducationSchema } from "./education.js";
import { ExperienceSchema } from "./experiences.js";
import { ExplorationSchema } from "./explorations.js";
import { PersonSchema } from "./person.js";
import { TechnologySchema } from "./catalogs.js";

/**
 * An exploration as the CV lists it: concise, with its status exactly as stored. Unknown fields of
 * a full exploration (topics, position, timestamps) are dropped.
 */
export const CvExplorationSchema = ExplorationSchema.pick({
  id: true,
  slug: true,
  name: true,
  summary: true,
  status: true,
  concepts: true,
  startedOn: true,
  endedOn: true,
  technologies: true,
}).meta({
  id: "CvExploration",
  description:
    "An exploration in the CV's own section: independent work outside the career timeline, never " +
    "an experience or a delivered project. `designed` means it exists only as a design.",
});

/** A list of technologies that all sit in one tier and group of the catalog. */
const technologiesIn = (
  tier: "primary" | "secondary",
  group: "core" | "ai_engineering_focus" | null,
  description: string,
) =>
  z
    .array(TechnologySchema)
    .refine(
      (list) => list.every((technology) => technology.tier === tier && technology.group === group),
      {
        message: `Every technology here has the tier ${tier} and the group ${String(group)}.`,
      },
    )
    .meta({ description: `${description} In catalog order: position, then slug.` });

/**
 * Everything the print-friendly CV needs, assembled from the stored profile in one read. It is CV
 * data, not the CV page, and the CV PDF it names is uploaded by hand, never generated from it.
 */
export const CvSchema = z
  .object({
    // A described copy of a shared schema loses its OpenAPI id, so the descriptions stay here.
    person: PersonSchema,
    experiences: z
      .array(ExperienceSchema)
      .refine((list) => list.every((experience) => experience.inCv), {
        message: "Only experiences selected for the CV appear in it.",
      })
      .meta({
        description:
          "The experiences selected for the CV (`inCv`), current roles first, then by start, " +
          "latest first, then by end, latest first, then by slug.",
      }),
    technologies: z
      .object({
        primary: z.object({
          core: technologiesIn("primary", "core", "The primary core technologies."),
          aiEngineeringFocus: technologiesIn(
            "primary",
            "ai_engineering_focus",
            "The primary technologies of the AI engineering focus.",
          ),
        }),
        secondary: technologiesIn("secondary", null, "The secondary technologies."),
      })
      .meta({ description: "The technology catalog in its tiers and groups." }),
    education: z
      .array(EducationSchema)
      .meta({ description: "Every education record, by position, then slug." }),
    explorations: z.array(CvExplorationSchema).meta({
      description:
        "Every exploration with its actual status, by position, then slug; a section of its own.",
    }),
    cvPdf: MediaSchema.nullable().meta({
      description:
        "The current, manually uploaded CV PDF the person names (`cvPdfId`), or `null` when " +
        "there is none. It is never generated or updated from this data.",
    }),
  })
  .refine((cv) => cv.cvPdf === null || cv.cvPdf.mediaType === "application/pdf", {
    message: "The current CV is a PDF.",
    path: ["cvPdf", "mediaType"],
  })
  .meta({
    id: "Cv",
    description:
      "`person` holds the contacts, links and summary (`shortBio`, `longBio`); the other fields " +
      "are the CV's sections.",
  });

export type CvExploration = z.infer<typeof CvExplorationSchema>;
export type Cv = z.infer<typeof CvSchema>;
