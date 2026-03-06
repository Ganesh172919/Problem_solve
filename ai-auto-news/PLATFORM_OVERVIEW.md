# AI Auto News — Platform Overview (Current Implementation)

This document describes what is implemented in the current `ai-auto-news` codebase. For hands-on usage, start with `docs/README.md`.

## What exists today

### Application

- **Next.js App Router** UI and API routes under `src/app/`.
- **SQLite storage** via `better-sqlite3`, with schema created on first open (`src/db/index.ts`).
- **Local admin dashboard** at `/admin` with cookie-based auth (`POST /api/auth`).

### Content automation

- A background **scheduler** (`src/scheduler/autoPublisher.ts`) that periodically publishes content.
- An in-process **task queue** (`src/workers/taskQueue.ts`) that polls tasks from SQLite and runs orchestration handlers.
- An autonomous publishing pipeline (`src/agents/autonomousPublisher.ts`) that:
  - researches a topic
  - generates content (blog/news)
  - formats it
  - stores it in SQLite

### APIs

- Public/local endpoints under `/api/*` for the UI and admin operations.
- A versioned `/api/v1/*` surface intended for API-key clients.
- Additional `/api/v2/*` and `/api/v3/*` routes exist but are **experimental** and not treated as stable.

See `docs/api.md` for details.

## What is experimental vs. production-grade

The app is designed as a **localhost-first** system with a simple persistence model (SQLite) and in-process background services.

The repository also contains many “platform-style” modules under `src/lib/` (billing/security/observability/etc). Unless a module is clearly wired into the primary flows (see `docs/architecture.md`), treat it as experimental or placeholder.

## Not implemented (despite prior aspirational docs)

The following are not currently implemented as a complete, production-ready system in this repo:

- A fully integrated hosted SaaS environment with real billing (Stripe), SSO, multi-region deployment, and operational maturity as an end-to-end product.
- A stable, versioned public API with formal compatibility guarantees across v2/v3.

The repo contains references, dependencies, and partial implementations for some of these ideas, but they are not documented as supported features unless they are wired into the running app.

