# Getting Started

## Prerequisites

- Node.js **18+** (recommended: Node 20+)
- npm (bundled with Node)

## Install

```bash
cd ai-auto-news
npm install
```

## Configure environment

Create a local env file:

```bash
cp .env.example .env.local
```

For a full list of variables, see [Configuration](configuration.md).

## Run (development)

```bash
npm run dev
```

Open `http://localhost:3000`.

### Admin login (local)

- Visit `http://localhost:3000/admin`
- Default credentials come from `.env.local`:
  - `ADMIN_USERNAME` (default `admin`)
  - `ADMIN_PASSWORD` (default `admin123`)

When you log in, `POST /api/auth` sets an `admin_token` cookie used by admin-only endpoints.

## Smoke test

The repo includes a smoke test that:

- starts the server (`dev` by default)
- waits for `/api/health`
- logs in as admin
- calls `/api/generate`

```bash
npm run smoke
```

## Run tests

```bash
npm test
```

## Reset local data

SQLite data lives under `ai-auto-news/data/` and is git-ignored.

To start fresh, stop the dev server and delete the files:

- `ai-auto-news/data/blog.db`
- `ai-auto-news/data/blog.db-wal`
- `ai-auto-news/data/blog.db-shm`

Then restart `npm run dev`.

