// llms.txt (https://llmstxt.org): the profile as Markdown for language models — who the person is,
// the site's pages and the experience, services, independent R&D and contact the API supplies, each
// linked to its stable anchor on the configured origin, and the AI Engineering Roadmap's pages with
// its areas, modules and books. Text from the API is written as plain words
// on one line with Markdown's link characters escaped, so it can never add a heading, a list item
// or a link of its own. Nothing is listed that the site does not show: no chat and no
// conversations. The diary's days are left to the sitemap: their titles are only dates.
import {
  anchorHref,
  bookshelfHref,
  cvPdfRoutes,
  explorationStatusText,
  formatDate,
  formatPeriod,
  plainText,
  roadmapHref,
  roadmapRoutes,
  routes,
} from "../../_shared";
import type { HomepageProfile } from "../../profile";
import type { RoadmapDiscovery } from "./roadmap-discovery";

/** The longest summary of one item. */
const SUMMARY_MAX = 280;
/** The longest bio, the first paragraph of the short bio. */
const BIO_MAX = 1_000;

/** Text on one line: every run of white space, line ends included, as one space. */
function line(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Link text that cannot close the link or open another one. */
function linkText(text: string): string {
  return line(text).replace(/[\\[\]]/g, (char) => `\\${char}`);
}

/** A web address that cannot close the link, or null for anything but http and https. */
function linkTarget(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href.replace(/[()]/g, (char) => (char === "(" ? "%28" : "%29"));
}

function item(text: string, target: string, description = ""): string | null {
  const href = linkTarget(target);
  if (href === null) return null;
  const link = `- [${linkText(text)}](${href})`;
  return description === "" ? link : `${link}: ${description}`;
}

function section(heading: string, items: readonly (string | null)[]): string[] {
  const lines = items.filter((entry): entry is string => entry !== null);
  return lines.length === 0 ? [] : [`## ${heading}`, "", ...lines, ""];
}

/** A sentence and its plain summary, without a trailing gap when there is no summary. */
function sentences(first: string, summary: string): string {
  const text = plainText(summary, SUMMARY_MAX);
  return text === "" ? first : `${first}. ${text}`;
}

/** The profile's llms.txt on `origin`. */
export function llmsTxt(
  origin: string,
  profile: HomepageProfile,
  roadmap: RoadmapDiscovery,
): string {
  const at = (path: string) => `${origin}${path}`;
  const bio = plainText(profile.shortBio, BIO_MAX);

  const pages = [
    item("Home", at(routes.home), "Profile, selected work, current focus and contact"),
    item(
      "Experience",
      at(routes.experience),
      "Career timeline, projects, technologies and independent R&D",
    ),
    item("Services", at(routes.services), "Services on offer and how a collaboration runs"),
    item("CV", at(routes.cv), "The CV as a web page"),
    profile.cvPdf === null
      ? null
      : item(
          "CV (PDF)",
          at(cvPdfRoutes.download),
          `The current CV as a PDF, uploaded on ${formatDate(profile.cvPdf.updatedOn)}`,
        ),
  ];

  const experiences = profile.experiences.map((experience) =>
    item(
      `${experience.title}, ${experience.organization.name}`,
      at(anchorHref({ kind: "experience", slug: experience.slug })),
      sentences(formatPeriod(experience.startedOn, experience.endedOn), experience.summary),
    ),
  );

  const services = profile.services.map((service) =>
    item(
      service.name,
      at(anchorHref({ kind: "service", slug: service.slug })),
      plainText(service.summary, SUMMARY_MAX),
    ),
  );

  const explorations = profile.explorations.map((exploration) => {
    const status = explorationStatusText(exploration.status);
    return item(
      exploration.name,
      at(anchorHref({ kind: "exploration", slug: exploration.slug })),
      sentences(`${status.label} (${status.meaning.toLowerCase()})`, exploration.summary),
    );
  });

  const roadmapPages = [
    item(
      "AI Engineering Roadmap",
      at(routes.aiRoadmap),
      "Learning areas and modules with their resources, progress and estimates",
    ),
    item("Learning Diary", at(roadmapRoutes.diary), "Study time, sessions and notes, day by day"),
    item(
      "Learning Statistics",
      at(roadmapRoutes.statistics),
      "Study time by area, module and period",
    ),
    item("Events", at(roadmapRoutes.events), "Events attended, with takeaways"),
    item("Bookshelf", at(roadmapRoutes.bookshelf), "Books read, being read and to read"),
    item(
      "How to Read Effectively",
      at(roadmapRoutes.readingGuide),
      "How to remember what you read",
    ),
  ];

  // An area and its modules nested below it, so the list keeps the roadmap's hierarchy.
  const areas = roadmap.areas.flatMap((area) => [
    item(
      area.name,
      at(roadmapHref({ area: area.slug })),
      plainText(area.description ?? "", SUMMARY_MAX),
    ),
    ...area.modules.map((module) => {
      const entry = item(
        module.name,
        at(roadmapHref({ area: area.slug, module: module.slug })),
        plainText(module.description ?? "", SUMMARY_MAX),
      );
      return entry === null ? null : `  ${entry}`;
    }),
  ]);

  const books = roadmap.books.map((book) =>
    item(
      book.author === null ? book.title : `${book.title} by ${book.author}`,
      at(bookshelfHref(book.slug)),
    ),
  );

  const email = profile.contact.email;
  const contact = [
    email === null ? null : `- Email: ${line(email.address)}`,
    ...profile.contact.links.map((link) => item(link.label, link.url)),
  ];

  return [
    `# ${line(profile.name)}`,
    "",
    `> ${line(profile.headline)}`,
    "",
    ...(bio === "" ? [] : [bio, ""]),
    ...section("Pages", pages),
    ...section("Experience", experiences),
    ...section("Services", services),
    ...section("Independent R&D", explorations),
    ...section("AI Engineering Roadmap", roadmapPages),
    ...section("Learning areas", areas),
    ...section("Bookshelf", books),
    ...section("Contact", contact),
  ].join("\n");
}
