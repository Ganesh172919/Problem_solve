# AI Auto News — Platform Documentation (Current Implementation)

This file is a concise “what/how” companion to the docs under `docs/`.

If you are looking for a table of contents, start at `docs/README.md`.

## Quick start (localhost)

```bash
cd ai-auto-news
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Storage

- SQLite database: `data/blog.db`
- The app creates tables/indexes on first open (`src/db/index.ts`).
- The `data/` directory is git-ignored.

## Background services

Two background services can run in-process:

- Scheduler: `src/scheduler/autoPublisher.ts`
- Task queue: `src/workers/taskQueue.ts`

Both are controlled by environment variables (see `docs/configuration.md`).

## Auth model (current)

- Admin endpoints: cookie auth via `POST /api/auth` and `admin_token`.
- v1 API: API key auth for most endpoints via `Authorization: Bearer aian_...`.
- One exception exists: `POST /api/v1/moderate` checks `x-api-key` header presence only.

See `docs/api.md`.

## Deployment artifacts

The repo contains Docker/Kubernetes/Terraform artifacts. Treat them as starting points and review before production usage.

