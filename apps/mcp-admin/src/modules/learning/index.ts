/**
 * The owner's learning tasks over the content module: find a stored resource, add one, set its
 * status, log a study session or event attendance, and add or change an event or a book.
 *
 * Every task reads and writes only through the caller's content API. A link is only compared with
 * stored links and never requested. A task that would duplicate a stored resource, event or book
 * is refused with a `conflict` that names the stored candidates, and nothing is sent; missing
 * required facts are a `field` error naming them. Statuses are the API's canonical resource
 * statuses; a book's state comes from its dates and an event's dates add no time. Each write is
 * one content write, sent once: a created record stays when a later task fails, and nothing is
 * deleted or resent to hide it.
 */
import { z } from "zod";

import type {
  CallerContent,
  ContentError,
  Outcome,
  SessionResult,
  WriteResult,
} from "../content/index.js";

/** A stored resource that matches a query, with the module and area it lies in. */
export interface ResourceCandidate {
  readonly slug: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly link: string | null;
  readonly book: string | null;
  readonly module: { readonly slug: string; readonly name: string };
  readonly area: { readonly slug: string; readonly name: string };
}

export interface FoundResources {
  readonly candidates: readonly ResourceCandidate[];
  /** `true` when more resources matched than are returned. */
  readonly truncated: boolean;
}

export interface NewResource {
  readonly module: string;
  readonly name: string;
  readonly type: string;
  readonly link?: string | undefined;
  readonly slug?: string | undefined;
  readonly status?: string | undefined;
  readonly estimatedMinutes?: number | undefined;
}

export interface StatusChange {
  readonly resource: string;
  readonly status: string;
  /** Absolute instants with `Z` or an offset; sent as UTC. */
  readonly startedAt?: string | undefined;
  readonly finishedAt?: string | undefined;
}

/** A session on exactly one of a resource, a book (through its linked resource) or an event. */
export interface Session {
  readonly resource?: string | undefined;
  readonly book?: string | undefined;
  readonly event?: string | undefined;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly notes?: string | undefined;
}

/** A create or a change of one event or book; `fields` are only the ones the owner stated. */
export interface RecordChange {
  readonly action: "create" | "update";
  readonly slug?: string | undefined;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface LearningTasks {
  /** Resources whose name or slug contains the query, or whose stored link equals a link query. */
  findResource(query: string): Promise<Outcome<FoundResources>>;
  /** Creates a resource at the end of an existing module. */
  addResource(resource: NewResource): Promise<Outcome<WriteResult>>;
  /** Changes a resource's status and only the dates given with it. */
  setResourceStatus(change: StatusChange): Promise<Outcome<WriteResult>>;
  /** Logs one session's time and notes in one write. */
  logSession(session: Session): Promise<Outcome<SessionResult>>;
  saveEvent(change: RecordChange): Promise<Outcome<WriteResult>>;
  saveBook(change: RecordChange): Promise<Outcome<WriteResult>>;
}

const MAX_CANDIDATES = 20;
const NEVER_INVENT = "Ask the owner for it; never invent it.";

const TreeSchema = z.object({
  areas: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      modules: z.array(
        z.object({
          slug: z.string(),
          name: z.string(),
          resources: z.array(
            z.object({
              slug: z.string(),
              name: z.string(),
              type: z.string(),
              status: z.string(),
              link: z.string().nullable().optional(),
              book: z.string().nullable().optional(),
              position: z.number().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});
type Tree = z.infer<typeof TreeSchema>;

const NamedSchema = z.object({ slug: z.string() }).catchall(z.unknown());
const BookSchema = z.object({
  slug: z.string(),
  title: z.string(),
  resource: z.object({ slug: z.string() }).nullable().optional(),
});

function fail<T>(error: ContentError): Outcome<T> {
  return { ok: false, error };
}

function fieldError<T>(message: string, paths: readonly string[], detail: string): Outcome<T> {
  return fail({
    code: "field",
    message,
    fields: paths.map((path) => ({ path, message: detail })),
  });
}

const UNREADABLE: ContentError = {
  code: "unavailable",
  message: "The stored content could not be read; nothing was written. Retry later.",
};

/** Lower case without diacritics or repeated spaces, for comparing names. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const isLink = (text: string) => /^https?:\/\//i.test(text.trim());

/** A link compared without case and without a trailing slash. */
function linkKey(link: string): string {
  return link.trim().toLowerCase().replace(/\/+$/, "");
}

/** A slug from a name: folded, with every run of other characters a single hyphen. */
function slugOf(text: string): string {
  return fold(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
}

/** An absolute instant with an offset as the UTC form the resource contract stores. */
const utc = (instant: string) => new Date(instant).toISOString();

function candidatesOf(tree: Tree): ResourceCandidate[] {
  return tree.areas.flatMap((area) =>
    area.modules.flatMap((module) =>
      module.resources.map((resource) => ({
        slug: resource.slug,
        name: resource.name,
        type: resource.type,
        status: resource.status,
        link: resource.link ?? null,
        book: resource.book ?? null,
        module: { slug: module.slug, name: module.name },
        area: { slug: area.slug, name: area.name },
      })),
    ),
  );
}

const without = (fields: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export function createLearningTasks(content: CallerContent): LearningTasks {
  async function tree(): Promise<Outcome<Tree>> {
    const read = await content.list("roadmap-resource");
    if (!read.ok) return read;
    const parsed = TreeSchema.safeParse(read.value);
    return parsed.success ? { ok: true, value: parsed.data } : fail(UNREADABLE);
  }

  async function records<T>(
    entity: "roadmap-event" | "roadmap-book",
    schema: z.ZodType<T>,
  ): Promise<Outcome<T[]>> {
    const read = await content.list(entity);
    if (!read.ok) return read;
    const parsed = z.array(schema).safeParse(read.value);
    return parsed.success ? { ok: true, value: parsed.data } : fail(UNREADABLE);
  }

  const duplicate = <T>(what: string, candidates: readonly unknown[]): Outcome<T> =>
    fail({
      code: "conflict",
      message: `${what} is already stored; nothing was written. Use the stored record or ask the owner.`,
      candidates,
    });

  const needsSlug = <T>(entity: string): Outcome<T> =>
    fieldError(`An ${entity} update names its record.`, ["slug"], "Required for an update.");

  return {
    async findResource(query) {
      const read = await tree();
      if (!read.ok) return read;
      const all = candidatesOf(read.value);
      const wanted = query.trim();
      const matches = isLink(wanted)
        ? all.filter(
            (resource) => resource.link !== null && linkKey(resource.link) === linkKey(wanted),
          )
        : fold(wanted).length === 0
          ? []
          : all.filter(
              (resource) =>
                fold(resource.name).includes(fold(wanted)) || resource.slug.includes(fold(wanted)),
            );
      return {
        ok: true,
        value: {
          candidates: matches.slice(0, MAX_CANDIDATES),
          truncated: matches.length > MAX_CANDIDATES,
        },
      };
    },

    async addResource(resource) {
      const read = await tree();
      if (!read.ok) return read;
      const module = read.value.areas
        .flatMap((area) => area.modules)
        .find((entry) => entry.slug === resource.module);
      if (!module) {
        return fail({
          code: "not_found",
          message: `No roadmap module "${resource.module}" exists; nothing was written.`,
        });
      }
      const all = candidatesOf(read.value);
      const link = resource.link;
      const sameLink =
        link === undefined
          ? []
          : all.filter((entry) => entry.link !== null && linkKey(entry.link) === linkKey(link));
      if (sameLink.length > 0) return duplicate("A resource with this link", sameLink);
      const sameName = all.filter(
        (entry) => entry.module.slug === module.slug && fold(entry.name) === fold(resource.name),
      );
      if (sameName.length > 0)
        return duplicate("A resource with this name in the module", sameName);

      const slug = resource.slug ?? slugOf(resource.name);
      if (slug.length === 0 || all.some((entry) => entry.slug === slug)) {
        return fieldError(
          "The resource needs another slug; nothing was written.",
          ["slug"],
          slug.length === 0
            ? "No slug can be derived from the name; give one."
            : `The slug "${slug}" is taken; ask the owner for another.`,
        );
      }
      const position =
        Math.max(-1, ...module.resources.map((entry, index) => entry.position ?? index)) + 1;
      return content.save("roadmap-resource", {
        action: "create",
        fields: without({
          slug,
          module: module.slug,
          name: resource.name,
          type: resource.type,
          link: resource.link,
          status: resource.status,
          estimatedMinutes: resource.estimatedMinutes,
          position,
        }),
      });
    },

    async setResourceStatus(change) {
      return content.save("roadmap-resource", {
        action: "update",
        id: change.resource,
        fields: without({
          status: change.status,
          startedAt: change.startedAt === undefined ? undefined : utc(change.startedAt),
          finishedAt: change.finishedAt === undefined ? undefined : utc(change.finishedAt),
        }),
      });
    },

    async logSession(session) {
      const targets = (["resource", "book", "event"] as const).filter(
        (target) => session[target] !== undefined,
      );
      if (targets.length !== 1) {
        return fieldError(
          "A session is on exactly one resource, book or event; nothing was sent.",
          targets.length === 0 ? ["resource"] : targets,
          "Give exactly one of `resource`, `book` and `event`.",
        );
      }
      if (!(Date.parse(session.endedAt) > Date.parse(session.startedAt))) {
        return fieldError(
          "The session's end is not after its start; nothing was sent.",
          ["endedAt"],
          "The end must be after the start.",
        );
      }
      let resource = session.resource;
      if (session.book !== undefined) {
        const read = await content.get("roadmap-book", session.book);
        if (!read.ok) return read;
        const book = BookSchema.safeParse(read.value);
        if (!book.success) return fail(UNREADABLE);
        if (!book.data.resource) {
          return fieldError(
            "The book has no linked resource to log its reading on; nothing was sent.",
            ["book"],
            "Link the book to a resource of type `book` first, or ask the owner.",
          );
        }
        resource = book.data.resource.slug;
      }
      return content.logSession({
        resource,
        event: session.event,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        notes: session.notes,
      });
    },

    async saveEvent({ action, slug, fields }) {
      if (action === "update") {
        if (slug === undefined) return needsSlug("event");
        return content.save("roadmap-event", { action, id: slug, fields: without(fields) });
      }
      const missing = ["name", "kind", "startsOn", "endsOn"].filter(
        (field) => fields[field] === undefined,
      );
      if (missing.length > 0) {
        return fieldError(
          "The event lacks required facts; nothing was written.",
          missing,
          NEVER_INVENT,
        );
      }
      const name = String(fields["name"]);
      const startsOn = String(fields["startsOn"]);
      const events = await records("roadmap-event", NamedSchema);
      if (!events.ok) return events;
      const year = startsOn.slice(0, 4);
      const newSlug = slug ?? `${slugOf(name)}-${year}`;
      const same = events.value.filter(
        (event) =>
          event.slug === newSlug ||
          (typeof event["name"] === "string" &&
            fold(event["name"]) === fold(name) &&
            String(event["startsOn"]).slice(0, 4) === year),
      );
      if (same.length > 0) return duplicate("This event", same);
      return content.save("roadmap-event", {
        action,
        fields: without({ slug: newSlug, ...fields }),
      });
    },

    async saveBook({ action, slug, fields }) {
      if (action === "update") {
        if (slug === undefined) return needsSlug("book");
        return content.save("roadmap-book", { action, id: slug, fields: without(fields) });
      }
      const title = fields["title"];
      if (typeof title !== "string") {
        return fieldError(
          "The book lacks its title; nothing was written.",
          ["title"],
          NEVER_INVENT,
        );
      }
      const books = await records("roadmap-book", BookSchema);
      if (!books.ok) return books;
      const newSlug = slug ?? slugOf(title);
      const same = books.value.filter(
        (book) => book.slug === newSlug || fold(book.title) === fold(title),
      );
      if (same.length > 0) return duplicate("This book", same);
      return content.save("roadmap-book", {
        action,
        fields: without({ slug: newSlug, ...fields }),
      });
    },
  };
}
