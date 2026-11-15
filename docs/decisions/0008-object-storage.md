# 0008 — Object storage through an S3 interface, Bunny in the cloud, disk for tests

Status: accepted
Date: 2026-11-15

## Decision

Images are stored through one storage interface with two drivers: Bunny Storage via its S3-compatible API, and local disk. Development and production use separate Bunny zones with separate keys; development adds a folder per worktree. Uploads go through a private API route. The database stores keys, not addresses.

## Why

Content is managed by agents without a redeploy, so images cannot be files in the repository. Object storage keeps the API stateless and puts images behind a CDN. Bunny is pay-per-use and already familiar to the owner. A disk driver lets tests, CI and a fresh clone run with no cloud account and no secrets.

## Rejected

- **A Docker volume served by the API.** Simplest, but files become state to back up and move with the server.
- **A local S3-compatible container (MinIO).** One more service to run for what a small disk driver covers.
- **One zone with environment folders.** A zone has one key, so development would hold a key able to delete production files.
- **Direct uploads to the bucket with presigned addresses.** Bypasses the trust boundary.
