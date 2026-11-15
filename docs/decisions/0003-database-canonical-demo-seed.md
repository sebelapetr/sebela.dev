# 0003 — The database is canonical; the repository ships only a demo seed

Status: accepted
Date: 2026-11-15

## Decision

PostgreSQL is the single source of content. The repository contains a fictional demo seed and nothing of the owner's data. The owner's real data is loaded once from a private seed kept outside the repository and is not maintained afterwards; safety comes from database backups.

## Why

Content is edited through the API without a redeploy. Any copy of real content in git would go stale the moment a record changed, contradicting "every fact is stored once". A public repository should also not carry personal data.

## Rejected

- **Real public profile data as a seed in the repository.** Convenient for a fresh clone, but it creates a second source of truth.
- **An export workflow that opens a pull request with an updated seed.** Keeps git in sync at the price of machinery nobody needs.
