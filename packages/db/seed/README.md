# Seed folders

A seed folder holds profile and AI roadmap content as JSON files plus the files they attach. One command loads it
into a migrated database:

```sh
pnpm --filter @sebela/api seed            # the fictional demo seed in packages/db/seed/demo/
pnpm --filter @sebela/api seed <folder>   # any other seed folder, for example a private one
pnpm --filter @sebela/api seed --if-empty # load only into an empty profile, otherwise skip
```

The command runs the backend services in-process (`SeedService.loadSeed` in `@sebela/services`). It
needs the database settings and the media settings of the environment (see `apps/api/AGENTS.md`),
but no running HTTP server and no API key. It prints counts only, never content and never the
folder's path. The exit code is 0 for a load or a skipped `--if-empty` load, 1 for a refused or unreadable seed and 2 for bad usage.

The repository contains only the fictional demo seed in `demo/`. Its records double as an example
of every file below. Its attached files are generated placeholders: logos, covers and illustrated
avatars for testimonial authors, never a photo of a real person. The owner's real content,
testimonial photos included, stays in the owner's private seed folder.

## Data files

Every data file is optional; an absent file leaves its kind of record untouched. Any other `.json`
file in the folder is refused, so a misspelt name does not silently load nothing.

| File                     | Holds                                                                | Identity                              |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------- |
| `person.json`            | one object: the person                                               | the single person                     |
| `technologies.json`      | an array of technologies                                             | `slug`                                |
| `topics.json`            | an array of topics                                                   | `slug`                                |
| `organizations.json`     | an array of organizations                                            | `slug`                                |
| `experiences.json`       | an array of experiences                                              | `slug`                                |
| `projects.json`          | an array of projects, each with an optional `caseStudy`              | `slug`; the case study by its project |
| `explorations.json`      | an array of explorations                                             | `slug`                                |
| `services.json`          | an array of services with their evidence                             | `slug`                                |
| `education.json`         | an array of education records                                        | `slug`                                |
| `testimonials.json`      | an array of testimonials                                             | `slug`                                |
| `current-focus.json`     | an array of current-focus entries                                    | `slug`                                |
| `roadmap-areas.json`     | an array of roadmap areas                                            | `slug`                                |
| `roadmap-modules.json`   | an array of roadmap modules, each naming its `area`                  | `slug`, unique across all modules     |
| `roadmap-resources.json` | an array of roadmap resources, each naming its `module` and `topics` | `slug`, unique across all resources   |

Each record has exactly the fields of the API's create request for its kind (the Zod schemas in
`@sebela/contracts`, documented in the OpenAPI document), with three differences:

- **Media are declared as files, not identifiers.** Instead of `photoId` and `cvPdfId` (person),
  `logoId` (organization), `coverId` (project) and `authorPhotoId` (testimonial), a record declares
  `photo`, `cvPdf`, `logo`, `cover` or `authorPhoto` as `{ "file": "files/portrait.jpg", "altText": "…" }` or `null`. `altText` is optional. An absent key behaves exactly like `null`: the record has no such attachment, so loading it clears one that is set (see superseded media below).
  A media identifier in a seed record is refused.
- **A project may carry its case study** as `caseStudy: { "role": "…", "body": "…" }`.
- **References are slugs**, as in the API: an experience names its `organization` and
  `technologies`, a project its `experience`, a service its evidence projects and explorations, a roadmap
  module its `area`, a roadmap resource its `module` and `topics`, and so on. A reference may name a record of the same folder or one already in the database.

A slug is unique within its file.

## Attached files

- A `file` path is relative to the seed folder, uses `/`, and contains no `..`. After symbolic
  links are resolved it must still lie inside the folder.
- Each file passes the same checks as an upload through the API: its content must be PNG, JPEG,
  WebP or PDF, within the configured size limit, and match its field (an image for `photo`, `logo`,
  `cover` and `authorPhoto`, a PDF for `cvPdf`).
- Files are recognised by content (SHA-256). A file already stored with identical content is
  reused instead of stored again, so a rerun uploads nothing. Two declarations of the same content
  must give the same alt text.

## Loading and reruns

- **Matching records are overwritten.** A record whose slug (or the person, or the case study of a
  project) already exists is updated to the seed's values, links included; its link lists are
  replaced, never appended. Edits made through the admin to such a record are therefore undone by a
  rerun. Records the seed does not name are kept, never deleted.
- **Roadmap modules and resources are matched by their own slug**, not by their parent. A rerun
  in which a module names another area, or a resource another module, moves the existing record
  there instead of creating a second one. Its topic links are replaced by the seed's list.
- **A rerun of an unchanged folder changes nothing**: no new records, links or media.
- **Changing a record in the seed** and loading again updates that record only.
- **Superseded media are removed.** When a seed record stops referring to a file (it declares
  another one, `null` or omits the key), the media it referred to before are deleted after the
  load, together with their stored files, unless anything still refers to them. This also applies
  to media attached by hand to a record the seed names: a rerun clears a photo, CV PDF, logo,
  cover or author photo the seed does not declare and deletes that media if nothing else uses it.
- **Reuse ignores the storage prefix.** A file is reused when any media record has identical
  content, even one stored under another environment or worktree prefix; such a record keeps its
  key, so its public address stays `null` in this environment.

## Worktree setup and the owner refresh

- **Worktree setup seeds only an empty profile.** `node harness/worktree.mjs create` runs
  `seed --if-empty` (`SeedService.loadSeedIntoEmpty`): it loads the demo seed only when the
  worktree's database holds no person, no record of any kind, no media and no roadmap area, and otherwise prints that
  the seed was skipped and writes nothing. Running setup again on an existing worktree therefore
  applies pending migrations but never overwrites content an agent has edited. The folder is still
  read and validated, so an invalid seed fails setup either way.
- **Refreshing a worktree from the seed is explicit.** The owner runs
  `pnpm --silent --filter @sebela/api seed` in the worktree. It loads the seed with the rerun rules
  above, so it overwrites the records the seed names, including edits made to them.

## Errors

- Everything is checked before the first write: the folder exists, every file is valid JSON, every
  record passes the API's input schemas, every attached file passes the upload checks and every
  reference resolves. Every problem found is reported in one refusal, each by file and field, for
  example `experiences.json[0].technologies[1]`. Nothing is written.
- A folder, data file or attached file that cannot be read (missing permissions, for example) is
  refused the same way, without the path the file system named.
- A failure during the load itself (for example a constraint the database refuses) rolls back every
  record written by this load and removes the files it stored. A file that cannot be removed is
  reported on the error output by its storage key.

## Private seed

The owner's real content lives in a private seed folder outside the repository and is loaded with
the same command:

```sh
pnpm --filter @sebela/api seed /path/to/private-seed
```

- A relative path is resolved against the directory the command was started from, not against
  `apps/api`.
- The folder is never committed, copied into the repository or printed by the command; only counts
  and field paths appear in its output. No credentials belong in the folder; the database and
  storage settings come from the environment.
- Point the command at the database you mean to fill. Creating, converting and loading the owner's
  actual seed is owner-led work.
