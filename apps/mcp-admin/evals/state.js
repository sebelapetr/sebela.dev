// @ts-check

/**
 * The fixture content a case-run could change, read through the API before and after it, and the
 * comparisons the scenarios' expected states use. Content comes from the public reads; recent
 * changes from the private audit read with a fixture key, never from the database.
 *
 * @typedef {Record<string, unknown>} ContentRecord
 *
 * @typedef {object} AuditEntry
 * @property {number} id
 * @property {{ keyName: string }} actor
 * @property {string} entity
 * @property {string | null} record
 * @property {string} action
 *
 * @typedef {object} DiaryEntry One logged interval as the diary shows it.
 * @property {string} target `resource:<slug>` or `event:<slug>`.
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {number} durationSeconds
 *
 * @typedef {object} DiaryDayState A diary day with notes or time entries.
 * @property {string | null} notes
 * @property {DiaryEntry[]} entries In start order.
 *
 * @typedef {object} ContentState
 * @property {ContentRecord | null} person
 * @property {Record<string, Record<string, ContentRecord>>} collections Records by entity, then slug.
 * @property {Record<string, ContentRecord | null>} caseStudies By project slug.
 * @property {Record<string, ContentRecord>} [media] The uploaded files' metadata by id; absent in a
 *   state stored before uploads were graded, which compares as no media.
 * @property {Record<string, DiaryDayState>} [diary] By Prague date; days with only a covering
 *   event are left out, because an event's dates add nothing to the diary.
 * @property {AuditEntry[]} audit Newest first, as the API returns it.
 */

/** The slug-keyed collections a case could touch, with their public list routes. */
export const COLLECTIONS = Object.freeze({
  organization: "/v1/organizations",
  experience: "/v1/experiences",
  project: "/v1/projects",
  service: "/v1/services",
  technology: "/v1/technologies",
  "roadmap-book": "/v1/roadmap/books",
  "roadmap-event": "/v1/roadmap/events",
});

/**
 * Reads the content state through the API.
 *
 * @param {string} apiUrl
 * @param {string} key A fixture key for the private recent-changes read.
 * @returns {Promise<ContentState>}
 */
export async function captureState(apiUrl, key) {
  const person = await read(apiUrl, "/v1/person");
  /** @type {Record<string, Record<string, ContentRecord>>} */
  const collections = {};
  for (const [entity, path] of Object.entries(COLLECTIONS)) {
    const records = await read(apiUrl, path);
    if (!Array.isArray(records)) throw new Error(`${path} returned no list.`);
    collections[entity] = Object.fromEntries(
      records.map((record) => [String(record["slug"]), contentRecord(entity, record)]),
    );
  }
  collections["roadmap-resource"] = roadmapResources(await read(apiUrl, "/v1/roadmap"));
  /** @type {Record<string, ContentRecord | null>} */
  const caseStudies = {};
  for (const slug of Object.keys(collections["project"] ?? {})) {
    caseStudies[slug] = await read(apiUrl, `/v1/projects/${slug}/case-study`);
  }
  const files = await read(apiUrl, "/v1/media");
  if (!Array.isArray(files)) throw new Error("/v1/media returned no list.");
  /** @type {Record<string, ContentRecord>} */
  const media = Object.fromEntries(files.map((record) => [String(record["id"]), record]));
  const recent = await read(apiUrl, "/v1/audit/changes", key);
  const audit = Array.isArray(recent?.["changes"])
    ? /** @type {AuditEntry[]} */ (recent["changes"])
    : [];
  const diary = diaryDays(await read(apiUrl, "/v1/roadmap/diary"));
  return {
    person: isRecord(person) ? person : null,
    collections,
    caseStudies,
    media,
    diary,
    audit,
  };
}

/**
 * The resources of the roadmap tree by slug, each with the slug of the module it lies in; the
 * tree has no list of its own for resources.
 *
 * @param {unknown} tree
 * @returns {Record<string, ContentRecord>}
 */
function roadmapResources(tree) {
  /** @type {Record<string, ContentRecord>} */
  const resources = {};
  const areas = isRecord(tree) && Array.isArray(tree["areas"]) ? tree["areas"] : [];
  for (const area of areas) {
    const modules = isRecord(area) && Array.isArray(area["modules"]) ? area["modules"] : [];
    for (const module of modules) {
      if (!isRecord(module) || !Array.isArray(module["resources"])) continue;
      for (const resource of module["resources"]) {
        if (!isRecord(resource)) continue;
        resources[String(resource["slug"])] = contentRecord("roadmap-resource", {
          ...resource,
          module: module["slug"],
        });
      }
    }
  }
  return resources;
}

/**
 * The diary by date: notes and entries, each entry naming its target by kind and slug.
 *
 * @param {unknown} diary
 * @returns {Record<string, DiaryDayState>}
 */
function diaryDays(diary) {
  /** @type {Record<string, DiaryDayState>} */
  const days = {};
  const list = isRecord(diary) && Array.isArray(diary["days"]) ? diary["days"] : [];
  for (const day of list) {
    if (!isRecord(day)) continue;
    const notes = typeof day["notes"] === "string" ? day["notes"] : null;
    const entries = (Array.isArray(day["entries"]) ? day["entries"] : [])
      .filter(isRecord)
      .map((entry) => ({
        target: isRecord(entry["event"])
          ? `event:${String(entry["event"]["slug"])}`
          : `resource:${String(isRecord(entry["resource"]) ? entry["resource"]["slug"] : "")}`,
        startedAt: String(entry["startedAt"]),
        endedAt: String(entry["endedAt"]),
        durationSeconds: Number(entry["durationSeconds"]),
      }));
    if (notes === null && entries.length === 0) continue;
    days[String(day["date"])] = { notes, entries };
  }
  return days;
}

/**
 * The records of an entity a case-run created.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @param {string} entity
 * @returns {ContentRecord[]}
 */
export function createdRecords(before, after, entity) {
  const was = before.collections[entity] ?? {};
  return Object.entries(after.collections[entity] ?? {})
    .filter(([slug]) => was[slug] === undefined)
    .map(([, record]) => record);
}

/**
 * The time entries logged during a case-run: every entry after it that was not there before,
 * with its diary date, in date and start order.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @returns {(DiaryEntry & { date: string })[]}
 */
export function newEntries(before, after) {
  /** @param {DiaryEntry} entry */
  const key = (entry) => `${entry.target} ${entry.startedAt} ${entry.endedAt}`;
  const existing = new Set(
    Object.values(before.diary ?? {}).flatMap((day) => day.entries.map(key)),
  );
  return Object.entries(after.diary ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([date, day]) =>
      day.entries.filter((entry) => !existing.has(key(entry))).map((entry) => ({ ...entry, date })),
    );
}

/**
 * Fields a public read embeds as the inverse of another record's own reference: an experience
 * lists the projects whose `experience` names it. The other record's field is compared instead.
 */
const INVERSE_FIELDS = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    experience: ["projects"],
  }),
);

/**
 * A record as the expected states compare it: its own fields, with every embedded record that has
 * a slug reduced to that slug and inverse lists dropped. A change to one record then fails only that
 * record's comparison, not every record that embeds it, while a changed reference still shows.
 *
 * @param {string} entity
 * @param {ContentRecord} record
 * @returns {ContentRecord}
 */
export function contentRecord(entity, record) {
  const inverse = INVERSE_FIELDS[entity] ?? [];
  return Object.fromEntries(
    Object.entries(record)
      .filter(([field]) => !inverse.includes(field))
      .map(([field, value]) => [field, references(value)]),
  );
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function references(value) {
  if (Array.isArray(value)) return value.map(references);
  if (!isRecord(value)) return value;
  if (typeof value["slug"] === "string") return value["slug"];
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, references(inner)]));
}

/**
 * @param {string} apiUrl
 * @param {string} path
 * @param {string} [key]
 * @returns {Promise<any>} the JSON body, or null for 404
 */
async function read(apiUrl, path, key) {
  const response = await fetch(new URL(path, apiUrl), {
    redirect: "error",
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}.`);
  return response.json();
}

/**
 * The expected state is the state before: no content and no case study changed.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @returns {string | null} the first difference, or null
 */
export function unchanged(before, after) {
  return unchangedExcept(before, after, {});
}

/**
 * The expected state is the state before with exactly the listed changes: field values of the
 * person, field values of slug-keyed records (or `null` for a deleted record), the number of
 * records of an entity the case creates, the number of newly uploaded files and the diary days the
 * case may change. The scenario checks created records and changed days itself. Changed records
 * may carry a new `updatedAt`; everything else, existing media included, must be identical.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @param {{ person?: Record<string, unknown> } & Record<string, Record<string, unknown> | undefined>} expected
 * @param {{ diary?: readonly string[], created?: Readonly<Record<string, number>>, newMedia?: number }} [also]
 *   Diary dates that may change, how many records of an entity the case creates and how many
 *   files it uploads (none by default).
 * @returns {string | null} the first difference, or null
 */
export function unchangedExcept(before, after, expected, also = {}) {
  const { person: personChange, ...recordChanges } = expected;
  const personFailure = compareRecord("person", before.person, after.person, personChange);
  if (personFailure) return personFailure;
  const was = before.media ?? {};
  const is = after.media ?? {};
  for (const id of Object.keys(was)) {
    if (is[id] === undefined) return `The media ${id} was deleted.`;
    if (!sameJson(was[id], is[id])) return `The media ${id} changed.`;
  }
  const uploads = also.newMedia ?? 0;
  const created = newMedia(before, after).length;
  if (created !== uploads) {
    return `Expected ${String(uploads)} uploaded file(s), found ${String(created)}.`;
  }
  for (const entity of new Set([
    ...Object.keys(before.collections),
    ...Object.keys(after.collections),
  ])) {
    const was = before.collections[entity] ?? {};
    const is = after.collections[entity] ?? {};
    const changes = /** @type {Record<string, unknown>} */ (recordChanges[entity] ?? {});
    const created = Object.keys(is).filter((slug) => was[slug] === undefined).length;
    if (created !== (also.created?.[entity] ?? 0)) {
      return `Expected ${String(also.created?.[entity] ?? 0)} new ${entity} records, found ${String(created)}.`;
    }
    for (const slug of new Set([...Object.keys(was), ...Object.keys(is)])) {
      const change = changes[slug];
      const label = `${entity} ${slug}`;
      if (change === null) {
        if (is[slug] !== undefined) return `The ${label} still exists.`;
        continue;
      }
      if (was[slug] === undefined) {
        if (also.created?.[entity]) continue;
        return `The ${label} was created.`;
      }
      if (is[slug] === undefined) return `The ${label} was deleted.`;
      const failure = compareRecord(
        label,
        was[slug],
        is[slug],
        /** @type {Record<string, unknown> | undefined} */ (change),
      );
      if (failure) return failure;
    }
  }
  for (const slug of new Set([
    ...Object.keys(before.caseStudies),
    ...Object.keys(after.caseStudies),
  ])) {
    const projectDeleted = recordChanges["project"]?.[slug] === null;
    if (projectDeleted) continue;
    if (!sameJson(before.caseStudies[slug] ?? null, after.caseStudies[slug] ?? null)) {
      return `The case study of ${slug} changed.`;
    }
  }
  const wasDiary = before.diary ?? {};
  const isDiary = after.diary ?? {};
  for (const date of new Set([...Object.keys(wasDiary), ...Object.keys(isDiary)])) {
    if (also.diary?.includes(date)) continue;
    if (!sameJson(wasDiary[date] ?? null, isDiary[date] ?? null)) {
      return `The diary day ${date} changed.`;
    }
  }
  return null;
}

/**
 * @param {string} label
 * @param {ContentRecord | null | undefined} was
 * @param {ContentRecord | null | undefined} is
 * @param {Record<string, unknown> | undefined} change
 * @returns {string | null}
 */
function compareRecord(label, was, is, change) {
  if (change === undefined) {
    return sameJson(was ?? null, is ?? null) ? null : `The ${label} changed.`;
  }
  if (!was || !is) return `The ${label} is missing.`;
  /** @type {Record<string, unknown>} */
  const wanted = { ...was, ...change, updatedAt: is["updatedAt"] };
  for (const key of new Set([...Object.keys(wanted), ...Object.keys(is)])) {
    if (!sameJson(wanted[key] ?? null, is[key] ?? null)) {
      return key in change
        ? `The ${label}'s ${key} is not the expected value.`
        : `The ${label}'s ${key} changed although only ${Object.keys(change).join(", ")} should.`;
    }
  }
  return null;
}

/**
 * The media records a case-run created, in no particular order.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @returns {ContentRecord[]}
 */
export function newMedia(before, after) {
  const was = before.media ?? {};
  return Object.entries(after.media ?? {})
    .filter(([id]) => was[id] === undefined)
    .map(([, record]) => record);
}

/**
 * The audited changes the API recorded for one key's name during a case-run, oldest first.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @param {string} keyName
 * @returns {AuditEntry[]}
 */
export function changesBy(before, after, keyName) {
  const last = Math.max(0, ...before.audit.map((entry) => entry.id));
  return after.audit
    .filter((entry) => entry.id > last && entry.actor.keyName === keyName)
    .sort((left, right) => left.id - right.id);
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function sameJson(left, right) {
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
