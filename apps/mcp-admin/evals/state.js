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
 * @typedef {object} ContentState
 * @property {ContentRecord | null} person
 * @property {Record<string, Record<string, ContentRecord>>} collections Records by entity, then slug.
 * @property {Record<string, ContentRecord | null>} caseStudies By project slug.
 * @property {AuditEntry[]} audit Newest first, as the API returns it.
 */

/** The slug-keyed collections a case could touch, with their public list routes. */
export const COLLECTIONS = Object.freeze({
  organization: "/v1/organizations",
  experience: "/v1/experiences",
  project: "/v1/projects",
  service: "/v1/services",
  technology: "/v1/technologies",
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
      records.map((record) => [String(record["slug"]), record]),
    );
  }
  /** @type {Record<string, ContentRecord | null>} */
  const caseStudies = {};
  for (const slug of Object.keys(collections["project"] ?? {})) {
    caseStudies[slug] = await read(apiUrl, `/v1/projects/${slug}/case-study`);
  }
  const recent = await read(apiUrl, "/v1/audit/changes", key);
  const audit = Array.isArray(recent?.["changes"])
    ? /** @type {AuditEntry[]} */ (recent["changes"])
    : [];
  return { person: isRecord(person) ? person : null, collections, caseStudies, audit };
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
 * person, and field values of slug-keyed records (or `null` for a deleted record). Changed records
 * may carry a new `updatedAt`; everything else must be identical.
 *
 * @param {ContentState} before
 * @param {ContentState} after
 * @param {{ person?: Record<string, unknown> } & Record<string, Record<string, unknown> | undefined>} expected
 * @returns {string | null} the first difference, or null
 */
export function unchangedExcept(before, after, expected) {
  const { person: personChange, ...recordChanges } = expected;
  const personFailure = compareRecord("person", before.person, after.person, personChange);
  if (personFailure) return personFailure;
  for (const entity of new Set([
    ...Object.keys(before.collections),
    ...Object.keys(after.collections),
  ])) {
    const was = before.collections[entity] ?? {};
    const is = after.collections[entity] ?? {};
    const changes = /** @type {Record<string, unknown>} */ (recordChanges[entity] ?? {});
    for (const slug of new Set([...Object.keys(was), ...Object.keys(is)])) {
      const change = changes[slug];
      const label = `${entity} ${slug}`;
      if (change === null) {
        if (is[slug] !== undefined) return `The ${label} still exists.`;
        continue;
      }
      if (was[slug] === undefined) return `The ${label} was created.`;
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
