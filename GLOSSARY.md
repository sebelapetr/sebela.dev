# Glossary

Canonical domain terms for this repository. Use these names in code, schemas, API contracts, issues, PRDs and documentation. Keep each entry short; put behaviour, relationships and product rules in [domain context](docs/domain-context.md), specifications or decision records instead.

| Term                       | Definition                                                                                                                             | Avoid                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **AI Engineering Roadmap** | The learning area of the site. **AI Roadmap** is its accepted short form.                                                              | “AI Engineering Path”, “Road to AI”                                |
| **Profile**                | The structured public content about the person and their professional work, stored under the `profile` schema.                         | “User profile” when referring to this content model                |
| **Experience**             | A period in a professional role at an organization; it belongs on the career timeline.                                                 | “Job” as the entity name                                           |
| **Project**                | Work delivered within an experience and described through its problem, contribution and result.                                        | “Exploration” for delivered work                                   |
| **Case study**             | A detailed account of a project that explains the person's role and the work.                                                          | “Project” for the long-form narrative itself                       |
| **Exploration**            | Independent, unreleased R&D outside the career timeline; its status says whether it was built, tested or only designed.                | “Side project” when that could imply delivered work; “experience”  |
| **Service**                | A defined kind of work a client can order, with its audience, deliverable and supporting evidence.                                     | “Consulting” or “training” as separate service categories          |
| **Technology**             | A tool or language associated with professional work and presented according to its technology tier.                                   | “Skill” when referring to a technology record                      |
| **Topic**                  | A subject shared by profile content and the AI Engineering Roadmap, such as RAG, MCP or agents.                                        | A technology when the subject is a concept                         |
| **Education**              | A school, course, certification or other learning milestone.                                                                           | “Experience”                                                       |
| **Testimonial**            | A quote from a client or colleague, associated with the experience it supports.                                                        | “Review”                                                           |
| **Current focus**          | Work or learning the person is focused on now.                                                                                         | “Experience” for ongoing focus without a role                      |
| **Media**                  | An uploaded file used by the profile, such as an image or CV PDF, with its storage and descriptive metadata.                           | “Attachment” as the domain entity name                             |
| **CV page**                | The print-friendly web page assembled from profile data. It is distinct from the downloadable PDF.                                     | “CV PDF” for the page                                              |
| **CV PDF**                 | The separately maintained downloadable PDF; it is not generated from the profile data.                                                 | “Generated CV”                                                     |
| **Demo seed**              | Fictional profile data committed to the repository for development and tests.                                                          | Real or anonymized owner data                                      |
| **Private seed**           | The owner's real profile data, kept outside the repository and loaded through the documented private process.                          | “Demo seed”                                                        |
| **Public route**           | A read-only API route that requires no API key, except the explicitly scoped public chat conversation routes.                          | “Unauthenticated write”                                            |
| **Private route**          | An API route that requires server-side API-key authentication; all content writes use private routes.                                  | “Admin route” unless it specifically means an admin-only operation |
| **API key**                | A revocable credential issued for a server-side caller and stored in the database as a hash; the raw value is shown only when created. | “JWT” for the API key itself                                       |
| **Knowledge base**         | Facts and approved explanatory evidence about Petr, from the portfolio API and supplemental sources.                                   | Visitor conversation history                                       |
| **Supplemental source**    | Owner-supplied material approved for public answers, with a privately stored original and versioned provenance.                        | Confidential knowledge that a public agent may disclose            |
| **Ingest**                 | Controlled import, extraction, checks and publication of a source version into the knowledge base.                                     | Automatically publishing any uploaded file                         |
| **Retrieval**              | Selecting relevant current evidence for a question.                                                                                    | The whole answer-generating pipeline                               |
| **RAG**                    | Retrieval-augmented generation: answering using evidence retrieved from the knowledge base.                                            | A separate product called conversation memory                      |
| **Knowledge graph**        | Concrete entities and source-backed relationships in the knowledge base.                                                               | The definitions of all permitted relationships                     |
| **Ontology**               | Versioned definitions of concepts, relationships and semantic constraints.                                                             | The concrete graph assertions themselves                           |
| **Conversation context**   | Bounded prior turns supplied to the agent from the visitor's stored conversation.                                                      | Knowledge about Petr or identity across browsers                   |

## Relationships

- An **Experience** contains delivered **Projects**; a **Case study** may explain one Project in depth.
- An **Exploration** is outside the Experience timeline and is never presented as delivered work. It can support a **Service** as evidence while retaining its status.
- **Topics** connect Profile content to the AI Engineering Roadmap; **Technologies** describe tools and languages.
- The **CV page** and **CV PDF** are separate outputs with separate maintenance paths.

## Updating this glossary

Change an entry when the owner settles a canonical term or meaning. Prefer one accepted name; put rejected synonyms in **Avoid**. Check [domain context](docs/domain-context.md), the current phase PRD and existing code for contradictions before changing a term. If the definition grows into behaviour or a product rule, keep only the short definition here and move the detail to its owning document. Remove stale entries instead of letting this file become a second PRD.

This repository uses the current `GLOSSARY.md` convention from Matt Pocock's domain-modeling workflow. The earlier `/ubiquitous-language` skill was folded into that workflow; see the [skill changelog](https://www.aihero.dev/skills/skills-changelog-ubiquitous-language-grill-with-docs) and [domain-modeling guide](https://www.aihero.dev/skills-domain-modeling).
