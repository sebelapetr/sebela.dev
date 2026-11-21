# Changelog

All notable changes to sebela.dev, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are counted from the Conventional Commits since the previous version (docs/release-workflow.md, Versions). From v0.3.0 on, each section is byte for byte the notes of its GitHub release, added by the release workflow after a healthy deployment; the sections of v0.1.0 to v0.2.1 were rendered again in this format from the same commits, so they differ from the older notes of their releases. There is no Unreleased section, because every merge into master is deployed.

## [v0.3.2] - 2026-11-21

### Fixes

- **mcp-admin**
  - make the E02 guessed-field check see snake_case and kebab-case names ([#342](https://github.com/sebelapetr/sebela.dev/pull/342))

### Other changes

- measure test coverage and publish it as a README badge ([#341](https://github.com/sebelapetr/sebela.dev/pull/341))

**Full Changelog**: [v0.3.1...v0.3.2](https://github.com/sebelapetr/sebela.dev/compare/v0.3.1...v0.3.2)

### Images

- `ghcr.io/sebelapetr/sebela-api:f8dd6db64212a15feb4c1daa601ca01a5f0023fe`
- `ghcr.io/sebelapetr/sebela-web:f8dd6db64212a15feb4c1daa601ca01a5f0023fe`
- `ghcr.io/sebelapetr/sebela-mcp-admin:f8dd6db64212a15feb4c1daa601ca01a5f0023fe`

## [v0.3.0] - 2026-11-21

### Features

- **ci**
  - attest build provenance and SBOMs of the release images ([#296](https://github.com/sebelapetr/sebela.dev/pull/296))
  - keep a changelog generated from each release ([#291](https://github.com/sebelapetr/sebela.dev/pull/291))

### Fixes

- **ci**
  - start paid model evals only on a phase pull request or by hand ([#338](https://github.com/sebelapetr/sebela.dev/pull/338))
  - publish no new version when the release commit is already tagged ([18cf8d3](https://github.com/sebelapetr/sebela.dev/commit/18cf8d3369d0d7b73825fd33b1d93f9dab9b96ce))
- **deps**
  - clear two vulnerable dev dependencies and pin pnpm in the images by hash ([#307](https://github.com/sebelapetr/sebela.dev/pull/307))
- **harness**
  - continue another branch only for an issue of a phase ([#327](https://github.com/sebelapetr/sebela.dev/pull/327))
- **infra**
  - deploy with the repository files of the release ([f7157f0](https://github.com/sebelapetr/sebela.dev/commit/f7157f045f6c1bf53faf7d90b4b89701ec30c7b8))

### Other changes

- **deps:** bump the docker group across 3 directories with 1 update ([#336](https://github.com/sebelapetr/sebela.dev/pull/336))
- **plan:** record the published phase 15 issues ([#324](https://github.com/sebelapetr/sebela.dev/pull/324))
- correct the eval trigger, formatting check and Prettier ignore descriptions ([#339](https://github.com/sebelapetr/sebela.dev/pull/339))
- extend dependabot to the npm workspace and the base images ([#326](https://github.com/sebelapetr/sebela.dev/pull/326))
- mark the generated API clients as generated for GitHub ([#313](https://github.com/sebelapetr/sebela.dev/pull/313))
- check formatting in CI, not only in the commit hook ([#325](https://github.com/sebelapetr/sebela.dev/pull/325))
- **plan:** apply the owner's decisions to the phase 15 pages PRD ([#318](https://github.com/sebelapetr/sebela.dev/pull/318))
- **plan:** add phase 15 for content pages and the privacy page ([#312](https://github.com/sebelapetr/sebela.dev/pull/312))
- count no documentation as a change of an app or package ([#304](https://github.com/sebelapetr/sebela.dev/pull/304))
- add OpenSSF Scorecard, CODEOWNERS and README badges ([#301](https://github.com/sebelapetr/sebela.dev/pull/301))
- **plan:** apply the owner's eval cost controls to phases 7 and 8 ([#297](https://github.com/sebelapetr/sebela.dev/pull/297))
- add security policy, contributing guide and issue and pull request templates ([#294](https://github.com/sebelapetr/sebela.dev/pull/294))
- pin third-party actions to commit SHAs and add dependabot ([#295](https://github.com/sebelapetr/sebela.dev/pull/295))
- refresh the README status for the live site ([#292](https://github.com/sebelapetr/sebela.dev/pull/292))
- ignore MCP Admin's documentation and count its eval skills ([97f4898](https://github.com/sebelapetr/sebela.dev/commit/97f48984fc691aabea5d1dcffe2b07d6bad569b3))
- count only the mcp-admin job of the model evals workflow ([959c590](https://github.com/sebelapetr/sebela.dev/commit/959c5900333c1d1f847115d09b1c43c3cee32e6e))
- run the MCP Admin model evals only for changes that can affect it ([05fc265](https://github.com/sebelapetr/sebela.dev/commit/05fc26518cb86887fb03170bcdb8e7e2aa02682c))
- **decisions:** renumber the checkout decision to 0025 ([c5522bd](https://github.com/sebelapetr/sebela.dev/commit/c5522bdd0333584ce32aa2357ab114fa78a93d55))

**Full Changelog**: [v0.2.1...v0.3.0](https://github.com/sebelapetr/sebela.dev/compare/v0.2.1...v0.3.0)

### Images

- `ghcr.io/sebelapetr/sebela-api:417b4d8c4de65eb8562a4d285431317e440ad5d4`
- `ghcr.io/sebelapetr/sebela-web:417b4d8c4de65eb8562a4d285431317e440ad5d4`
- `ghcr.io/sebelapetr/sebela-mcp-admin:417b4d8c4de65eb8562a4d285431317e440ad5d4`

## [v0.2.1] - 2026-11-21

Re-release of v0.2.0 (same commit, same images): created when the deploy job was rerun after the rollback test of #237.

No changes since v0.2.0; re-release of the same commit.

### Images

- `ghcr.io/sebelapetr/sebela-api:7c2a8c4b7bff224cbf49696a88ef582e80b497f5`
- `ghcr.io/sebelapetr/sebela-web:7c2a8c4b7bff224cbf49696a88ef582e80b497f5`
- `ghcr.io/sebelapetr/sebela-mcp-admin:7c2a8c4b7bff224cbf49696a88ef582e80b497f5`

## [v0.2.0] - 2026-11-21

### Highlights

**Phase 09: RAG knowledge base** ([#280](https://github.com/sebelapetr/sebela.dev/pull/280)).

### Features

- **infra**
  - trust Bunny's edges to name the visitor in nginx ([#284](https://github.com/sebelapetr/sebela.dev/pull/284))
- **memory**
  - ingest text-layer PDF documents ([#278](https://github.com/sebelapetr/sebela.dev/pull/278))
  - rank passages with hybrid search and the Voyage reranker ([#277](https://github.com/sebelapetr/sebela.dev/pull/277))
- **retrieval**
  - manage source lifecycle, keep API facts first and freeze thresholds ([#276](https://github.com/sebelapetr/sebela.dev/pull/276))
  - ingest, review and approve documents kept in private storage ([#275](https://github.com/sebelapetr/sebela.dev/pull/275))
  - keep portfolio passages current after content writes ([#272](https://github.com/sebelapetr/sebela.dev/pull/272))
  - search the indexed portfolio through a private, measured route ([#250](https://github.com/sebelapetr/sebela.dev/pull/250))

### Other changes

- **plan:** archive the 09-rag plan ([#279](https://github.com/sebelapetr/sebela.dev/pull/279))

**Full Changelog**: [v0.1.0...v0.2.0](https://github.com/sebelapetr/sebela.dev/compare/v0.1.0...v0.2.0)

### Images

- `ghcr.io/sebelapetr/sebela-api:7c2a8c4b7bff224cbf49696a88ef582e80b497f5`
- `ghcr.io/sebelapetr/sebela-web:7c2a8c4b7bff224cbf49696a88ef582e80b497f5`
- `ghcr.io/sebelapetr/sebela-mcp-admin:7c2a8c4b7bff224cbf49696a88ef582e80b497f5`

## [v0.1.0] - 2026-11-21

### Highlights

**Phase 10: Continuous delivery** ([#262](https://github.com/sebelapetr/sebela.dev/pull/262)).

**Phase 05: MCP admin** ([#175](https://github.com/sebelapetr/sebela.dev/pull/175)).

**Phase 04: AI Roadmap** ([#170](https://github.com/sebelapetr/sebela.dev/pull/170)).

**Phase 03-web** ([#125](https://github.com/sebelapetr/sebela.dev/pull/125)).

**Phase 02-api-db: API and database** ([#120](https://github.com/sebelapetr/sebela.dev/pull/120)).

**Phase 01: foundation** ([#77](https://github.com/sebelapetr/sebela.dev/pull/77)).

**Phase 0: plan the project and build the agent harness** ([#14](https://github.com/sebelapetr/sebela.dev/pull/14)).

### Features

- **api**
  - add a media upload command so photos and PDFs never pass through the model ([#248](https://github.com/sebelapetr/sebela.dev/pull/248))
- **harness**
  - keep the owner's secrets in a main-checkout .env.secrets agents never see ([b7481f6](https://github.com/sebelapetr/sebela.dev/commit/b7481f6559a4186b1fb33e77ad2298c315e01341))
  - give worktrees the owner's model eval key and run evals on phase pull requests ([d40761d](https://github.com/sebelapetr/sebela.dev/commit/d40761d13580ff0642475309cb8b9a7521581558))
  - let the owner hand the orchestrator a note when starting the loop ([#124](https://github.com/sebelapetr/sebela.dev/pull/124))
  - give each worktree its own database role and credentials ([#84](https://github.com/sebelapetr/sebela.dev/pull/84)) ([#94](https://github.com/sebelapetr/sebela.dev/pull/94))
  - show who works on which issue and how far the phase is ([#87](https://github.com/sebelapetr/sebela.dev/pull/87))
  - check the machine, notify the owner and report each phase ([#86](https://github.com/sebelapetr/sebela.dev/pull/86))
  - add a reporting steward and compaction instructions ([#82](https://github.com/sebelapetr/sebela.dev/pull/82))
- **mcp-admin**
  - record the owner's acceptance and run only affected eval suites in CI ([#157](https://github.com/sebelapetr/sebela.dev/pull/157)) ([#193](https://github.com/sebelapetr/sebela.dev/pull/193))
  - upload and attach media through the profile and CV flow ([#192](https://github.com/sebelapetr/sebela.dev/pull/192))
  - record learning sessions, resources, books and events through task tools ([#191](https://github.com/sebelapetr/sebela.dev/pull/191))
  - manage content through constrained MCP tools with atomic API audit ([#174](https://github.com/sebelapetr/sebela.dev/pull/174))
  - pin Sonnet 5.5 for the evals, run only affected cases and regrade for free ([#173](https://github.com/sebelapetr/sebela.dev/pull/173))
  - connect MCP Admin to the content API ([#153](https://github.com/sebelapetr/sebela.dev/pull/153)) ([#172](https://github.com/sebelapetr/sebela.dev/pull/172))
- **roadmap**
  - explore reconciled learning statistics ([#167](https://github.com/sebelapetr/sebela.dev/pull/167))
  - carry over the AI Roadmap overview on the API-backed roadmap domain ([#160](https://github.com/sebelapetr/sebela.dev/pull/160))
- **web**
  - source-code links, mobile footer and typography, natural Ask chat scrolling ([#249](https://github.com/sebelapetr/sebela.dev/pull/249))
  - complete roadmap supporting content, discovery and phase handoff ([#169](https://github.com/sebelapetr/sebela.dev/pull/169))
  - enable optional privacy-friendly analytics through configuration ([#151](https://github.com/sebelapetr/sebela.dev/pull/151))
  - run the complete website stack in Docker and isolated worktrees ([#150](https://github.com/sebelapetr/sebela.dev/pull/150))
  - keep every page usable with absent content and unavailable dependencies ([#148](https://github.com/sebelapetr/sebela.dev/pull/148))
  - recover cached content when invalidation delivery fails ([#147](https://github.com/sebelapetr/sebela.dev/pull/147))
  - refresh rendered pages through signed API invalidation ([#145](https://github.com/sebelapetr/sebela.dev/pull/145))
  - serve responsive media and Open Graph previews ([#144](https://github.com/sebelapetr/sebela.dev/pull/144))
  - publish profile metadata, indexing files and llms.txt ([#143](https://github.com/sebelapetr/sebela.dev/pull/143))
  - recover interrupted mock chats without duplicate questions ([#142](https://github.com/sebelapetr/sebela.dev/pull/142))
  - verify mock answers through safe rich blocks and exact site sources ([#140](https://github.com/sebelapetr/sebela.dev/pull/140))
  - ask a hero question through the shared streaming mock-chat contract ([#139](https://github.com/sebelapetr/sebela.dev/pull/139))
  - navigate every page with a mobile menu and persistent theme ([#138](https://github.com/sebelapetr/sebela.dev/pull/138))
  - complete the homepage narrative with now, experience snapshot, services summary and roadmap placeholder ([#137](https://github.com/sebelapetr/sebela.dev/pull/137))
  - print-friendly CV page and manually uploaded PDF download ([#136](https://github.com/sebelapetr/sebela.dev/pull/136))
  - explain three services through evidence and a contact path ([#135](https://github.com/sebelapetr/sebela.dev/pull/135))
  - show R&D, technology groups and education on Experience ([#133](https://github.com/sebelapetr/sebela.dev/pull/133))
  - open selected project evidence and case studies at exact deep links ([#131](https://github.com/sebelapetr/sebela.dev/pull/131))
  - tell the career through a timeline on /experience ([#129](https://github.com/sebelapetr/sebela.dev/pull/129))
  - reserve the hero's chat place and record the visual foundations ([#126](https://github.com/sebelapetr/sebela.dev/pull/126))
  - render an API-backed homepage ([#123](https://github.com/sebelapetr/sebela.dev/pull/123))
- roadmap events and event attendance in the learning diary ([#166](https://github.com/sebelapetr/sebela.dev/pull/166))
- add the bookshelf and book pages backed by managed books ([#164](https://github.com/sebelapetr/sebela.dev/pull/164))
- learning diary with Prague-day time entries ([#163](https://github.com/sebelapetr/sebela.dev/pull/163))
- roadmap detail pages and current learning on the homepage ([#110](https://github.com/sebelapetr/sebela.dev/pull/110)) ([#162](https://github.com/sebelapetr/sebela.dev/pull/162))
- show the author's photo beside a testimonial ([#130](https://github.com/sebelapetr/sebela.dev/pull/130))

### Fixes

- **ci**
  - run the release browser step without blocking the smoke check's requests ([#282](https://github.com/sebelapetr/sebela.dev/pull/282))
  - build the release images without reading output that goes to the log ([#270](https://github.com/sebelapetr/sebela.dev/pull/270))
  - set temporary paths in steps, where the runner context exists ([#269](https://github.com/sebelapetr/sebela.dev/pull/269))
- **docs**
  - keep the hosting provider and server details out of the repository ([#264](https://github.com/sebelapetr/sebela.dev/pull/264))
- **harness**
  - keep agents away from the production stack ([#266](https://github.com/sebelapetr/sebela.dev/pull/266))
  - run the website's browser tests one at a time per machine ([#247](https://github.com/sebelapetr/sebela.dev/pull/247))
  - keep agents off the shared Compose stack ([#243](https://github.com/sebelapetr/sebela.dev/pull/243))
  - report the real phase state after phase_done ([46ae8b7](https://github.com/sebelapetr/sebela.dev/commit/46ae8b792bae2bdbd8e8113c3694ed0b3aa71b75))
  - tell safeguard refusals and environment stops apart from usage limits ([18c0ab3](https://github.com/sebelapetr/sebela.dev/commit/18c0ab36bd8eb7952d4af0b6fd8a85dab2660765))
  - create pgvector for worktree roles as the superuser ([348a326](https://github.com/sebelapetr/sebela.dev/commit/348a3269e96681c88186c1c634c0e1cb33e06912))
  - wait instead of failing an issue the usage limit interrupts ([#100](https://github.com/sebelapetr/sebela.dev/pull/100))
  - stop the guard refusing harmless commands ([#90](https://github.com/sebelapetr/sebela.dev/pull/90))
  - follow agents the orchestrator continues with SendMessage ([#89](https://github.com/sebelapetr/sebela.dev/pull/89))
- **mcp-admin**
  - owner acceptance findings — book resource error, pinned Promptfoo, ask on ambiguous records ([#242](https://github.com/sebelapetr/sebela.dev/pull/242))
  - accept a Czech request for the interval without a question mark in E15 ([01fac16](https://github.com/sebelapetr/sebela.dev/commit/01fac166d2e3cc6e886627425c4318c503c04397))

### Other changes

- **plan:** add phase 14 for a public architecture floorplan ([#257](https://github.com/sebelapetr/sebela.dev/pull/257))
- **plan:** document sub-phases NN.M for work that builds on a phase ([#255](https://github.com/sebelapetr/sebela.dev/pull/255))
- **plan:** add phase 7.1 to measure Jev as the Security Gateway classifier ([#254](https://github.com/sebelapetr/sebela.dev/pull/254))
- **agents:** run only the affected browser specs locally; the whole suite in CI ([#251](https://github.com/sebelapetr/sebela.dev/pull/251))
- **plan:** archive merged phases in .plan/done ([ba7be2a](https://github.com/sebelapetr/sebela.dev/commit/ba7be2a1b514cfe130a6820c392c491f5f046f77))
- **delivery:** index the six published phase-10 issues ([0a1ef1e](https://github.com/sebelapetr/sebela.dev/commit/0a1ef1ee4cfdcb7bcd3be693c820cbbfa238e3b2))
- **delivery:** plan phase 10 as incremental delivery to sebela.dev ([c29dcaa](https://github.com/sebelapetr/sebela.dev/commit/c29dcaa36690a021a8ba16dae166ff76a49c0c24))
- **rag:** plan phase 9 as a private knowledge base, add 9.1 and 9.2 ([#229](https://github.com/sebelapetr/sebela.dev/pull/229))
- drop an accidentally committed node_modules link ([feae4de](https://github.com/sebelapetr/sebela.dev/commit/feae4dec77d4b63baf58f87dbd9aeb0529f7c71d))
- **rag:** plan phase 9 as a private knowledge base, add 9.1 and 9.2 ([ea6a36f](https://github.com/sebelapetr/sebela.dev/commit/ea6a36f20b44e0f461d31e5b989b4b10e9e7ecb5))
- **ai-service:** publish seven phase 07 implementation issues ([f3a1a77](https://github.com/sebelapetr/sebela.dev/commit/f3a1a775e673d729575cda947670d1534d4e8216))
- **ai-service:** specify phase 07 runtime and telemetry ([9269393](https://github.com/sebelapetr/sebela.dev/commit/92693938ecd6888beca49f94f92aaa80906fde76))
- **agents:** read every issue with its comments and pass owner notes on ([709fc98](https://github.com/sebelapetr/sebela.dev/commit/709fc987153d3e3e9f7db1abd6ced5a652eaff65))
- update project status and MCP Admin setup ([5b8529b](https://github.com/sebelapetr/sebela.dev/commit/5b8529b7e2fa2e4e5af92a5ee06245eddcaeb2f7))
- run CI once per commit on phase branches and model evals only when a phase pull request is ready ([7e1d00f](https://github.com/sebelapetr/sebela.dev/commit/7e1d00fa0c2b4abbe226be57cb914b5a5bb8102e))
- skip the website jobs for changes that cannot affect the website ([63ee9a6](https://github.com/sebelapetr/sebela.dev/commit/63ee9a69312eb38f97a23168be298d12609d2d8b))
- **llm-agent:** publish six phase 06 implementation issues ([#184](https://github.com/sebelapetr/sebela.dev/pull/184))
- **llm-agent:** finalize phase 06 design and eval policy ([#176](https://github.com/sebelapetr/sebela.dev/pull/176))
- **plan:** run phase 5 model evals locally and on the phase pull request ([a7ae22c](https://github.com/sebelapetr/sebela.dev/commit/a7ae22cfcd8c7ccda53a6f7a437a09f385066c1e))
- **readme:** list the learning statistics page as built ([#168](https://github.com/sebelapetr/sebela.dev/pull/168))
- **readme:** list the bookshelf as built ([#165](https://github.com/sebelapetr/sebela.dev/pull/165))
- **readme:** describe the AI Roadmap overview instead of a placeholder ([#161](https://github.com/sebelapetr/sebela.dev/pull/161))
- **mcp-admin:** make the initial connection slice afk ([cd071a9](https://github.com/sebelapetr/sebela.dev/commit/cd071a96c3d109c9737b68f26387c2a5b9a68e2c))
- **mcp-admin:** publish five implementation issues ([eba7d89](https://github.com/sebelapetr/sebela.dev/commit/eba7d89639cce097a6b36554e5f6585cb4f4aea9))
- **web:** merge master into phase/03-web ([48e7436](https://github.com/sebelapetr/sebela.dev/commit/48e7436dcae76acd41e1a9ef08360638491243ff))
- **web:** verify the website handoff and fix long-content overflow ([#152](https://github.com/sebelapetr/sebela.dev/pull/152))
- **agents:** run only touched browser specs while developing, the whole suite once per review ([#149](https://github.com/sebelapetr/sebela.dev/pull/149))
- **web:** run the browser test files in parallel ([#141](https://github.com/sebelapetr/sebela.dev/pull/141))
- state the invalidation receiver's public exposure and per-process cache ([#146](https://github.com/sebelapetr/sebela.dev/pull/146))
- **plan:** split ai delivery and knowledge phases ([#134](https://github.com/sebelapetr/sebela.dev/pull/134))
- **api:** give the API's tests two minutes ([#132](https://github.com/sebelapetr/sebela.dev/pull/132))
- **design:** note the forced-colours focus gap on buttons ([#127](https://github.com/sebelapetr/sebela.dev/pull/127))
- **roadmap:** finalize PRD and publish seven implementation issues ([#108](https://github.com/sebelapetr/sebela.dev/pull/108))
- **plan:** plan a parallel phase loop ([#91](https://github.com/sebelapetr/sebela.dev/pull/91))
- **infra:** pin the Postgres image to its digest ([#81](https://github.com/sebelapetr/sebela.dev/pull/81))
- **plan:** give each worktree its own database credentials in phase 2 ([#80](https://github.com/sebelapetr/sebela.dev/pull/80))
- **harness:** move the harness to a top-level harness/ folder ([#78](https://github.com/sebelapetr/sebela.dev/pull/78))
- **harness:** track a readme for the shared agent memory folder ([#74](https://github.com/sebelapetr/sebela.dev/pull/74))
- **harness:** repository settings only, worktree temp files, shared agent memory ([#73](https://github.com/sebelapetr/sebela.dev/pull/73))
- **harness:** load only the MCP servers agents need in the phase loop ([#71](https://github.com/sebelapetr/sebela.dev/pull/71))
- **agents:** lower developer effort and resume interrupted issues ([#69](https://github.com/sebelapetr/sebela.dev/pull/69))
- **ai:** define separate runtime and shared agent pipeline ([#64](https://github.com/sebelapetr/sebela.dev/pull/64))
- finalize phase plans and establish project standards ([#62](https://github.com/sebelapetr/sebela.dev/pull/62))
- Initial commit ([5be503c](https://github.com/sebelapetr/sebela.dev/commit/5be503cd7b636440968bb949fa8b18b0aca170f2))

**Full Changelog**: [v0.1.0](https://github.com/sebelapetr/sebela.dev/commits/v0.1.0)

### Images

- `ghcr.io/sebelapetr/sebela-api:92e99dfc8a25bcabedfbf866e17c706f7d65b981`
- `ghcr.io/sebelapetr/sebela-web:92e99dfc8a25bcabedfbf866e17c706f7d65b981`
- `ghcr.io/sebelapetr/sebela-mcp-admin:92e99dfc8a25bcabedfbf866e17c706f7d65b981`

[v0.3.2]: https://github.com/sebelapetr/sebela.dev/releases/tag/v0.3.2
[v0.3.0]: https://github.com/sebelapetr/sebela.dev/releases/tag/v0.3.0
[v0.2.1]: https://github.com/sebelapetr/sebela.dev/releases/tag/v0.2.1
[v0.2.0]: https://github.com/sebelapetr/sebela.dev/releases/tag/v0.2.0
[v0.1.0]: https://github.com/sebelapetr/sebela.dev/releases/tag/v0.1.0
