# Security policy

sebela.dev is a personal website, but it has a real attack surface: a public API, a chat that visitors use, two MCP servers and an automated deployment. Reports are welcome and taken seriously.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/sebelapetr/sebela.dev/security/advisories/new)).

**Never report a vulnerability in a public issue, discussion or pull request.** If you are not sure whether something is a vulnerability, report it privately anyway.

A useful report says:

- what is affected (a URL, an API route, an MCP tool, a workflow or a file and line);
- how to reproduce it, step by step, with the smallest example you have;
- what an attacker gains (for example reading private data, writing content, running code, spending the owner's model budget);
- whether you have shared it with anyone else.

## Scope

In scope:

- the website [sebela.dev](https://sebela.dev);
- the public API routes, including the visitor chat;
- the admin MCP server and the public MCP server;
- the release and deployment pipeline (`.github/workflows/`, `scripts/release/`, `infra/`);
- this repository itself: the code, the agent harness (`harness/`), its hooks and the checks that protect `master`.

Particularly interesting are anything that crosses the [trust boundary](docs/architecture.md#the-api-is-the-trust-boundary) — a public caller writing content, reading private operational data or reaching the database — a leaked or bypassed API key, a prompt injection that makes the chat or an MCP server act outside its rules, and a way to get unreviewed code deployed. The [threat model](docs/threat-model.md) lists the known defences and accepted residual risks of the chat and the public MCP server; a way around a listed defence is in scope.

Out of scope:

- the fictional data of the demo seed (`packages/db/seed/demo/`) and of the test fixtures: it is public on purpose and describes no real person;
- denial-of-service and load testing, volumetric or otherwise; please do not run them against the live site;
- social engineering, phishing or physical attacks against the owner or anyone else;
- vulnerabilities in third-party services and platforms the project uses (report those to their vendors), unless the way this project configures or uses them is the problem;
- findings without a demonstrated impact, such as missing headers on their own or version banners.

## Supported versions

Only the latest release, deployed from `master`, is supported. Fixes are made on `master` and ship with the next release; older versions and unmerged branches receive no fixes.

## What to expect

This project is maintained by one person. Expectations are set accordingly:

- an acknowledgement of your report within **7 days**;
- an assessment and, where needed, a fix on a best-effort basis, with updates in the private advisory as it progresses;
- credit in the published advisory if you want it.

Please give a reasonable time to fix the issue before you disclose it publicly; we can agree a date in the advisory.

## Safe harbour

Research done in good faith under this policy is welcome. If you:

- test only within the scope above,
- avoid privacy violations, data destruction and service degradation,
- access no more data than needed to show the issue, and do not keep or share it,
- stop and report as soon as you reach anything that looks like real personal or private data,

then the owner will not pursue or support legal action against you for that research, and will treat it as authorised. If something is unclear, ask in the private report before you go further.
