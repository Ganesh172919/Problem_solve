# API

This app exposes multiple API surfaces:

- **Local/public API** under `/api/*` (used by the UI)
- **Versioned API** under `/api/v1/*` (intended for API key clients)
- **Experimental APIs** under `/api/v2/*` and `/api/v3/*` (not stable; see below)

Base URL (local dev): `http://localhost:3000`

## Authentication modes

### Admin cookie (local)

- `POST /api/auth` sets an `admin_token` HTTP-only cookie.
- Routes that call `requireAdminCookie()` will return `401` without it.

### API key (v1)

- Most v1 endpoints authenticate via `Authorization: Bearer <api_key>`.
- API key format is `aian_` + 64 hex chars.

Note: `POST /api/v1/moderate` is an exception (it checks `x-api-key` presence only; see below).

## Local bootstrap (for v1 API key testing)

There is no “first key” bootstrap endpoint (creating keys requires an existing key). For local development:

1) Create a user (server running):

```bash
curl -sS -X POST http://localhost:3000/api/users ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"dev@example.com\",\"username\":\"dev\",\"password\":\"devpass123\"}"
```

2) Mint an API key directly into SQLite (dev-only helper):

```bash
cd ai-auto-news
node scripts/dev-mint-api-key.mjs --email dev@example.com --name "local-dev" --scopes read,generate
```

3) Call a v1 endpoint:

```bash
curl -sS http://localhost:3000/api/v1/posts -H "Authorization: Bearer aian_..."
```

## Admin endpoints (cookie auth)

### `POST /api/auth`

- Auth: none
- Body: `{ "username": string, "password": string }`
- Sets: `admin_token` cookie
- Responses:
  - `200 { "success": true }`
  - `401 { "error": "Invalid credentials" }`

### `GET /api/admin`

- Auth: admin cookie required
- Returns system stats (posts/scheduler/users/subscriptions/task queue/usage).

### `POST /api/generate`

- Auth: admin cookie required
- Triggers a single autonomous publishing cycle.

### `POST /api/scheduler`

- Auth: admin cookie required
- Toggles the scheduler on/off.

### `GET /api/metrics`

- Auth: admin cookie required
- Returns system metrics snapshots.

### `GET /api/analytics`

- Auth: admin cookie required
- Query params:
  - `view=overview|events|daily` (default `overview`)
  - `days=<n>` (default `7`)
  - `event=<name>` (for some views)

### `DELETE /api/posts/[slug]`

- Auth: admin cookie required
- Deletes a post by slug.

## Public endpoints (no auth)

### `GET /api/health`

- Returns health status and basic checks.

### `GET /api/posts`

- Query params:
  - `page` (default `1`)
  - `limit` (default `10`, max `50`)
  - `category` (optional)
- Note: this route calls `initializeScheduler()` at runtime to start background services (when enabled).

### `GET /api/posts/[slug]`

- Returns a single post by slug.

### `GET /api/search`

- Query params:
  - `q` (required)
  - `page` (default `1`)
  - `limit` (default `10`, max `50`)
- Includes IP rate limiting for abuse prevention.

### `GET /api/scheduler`

- Returns scheduler status (running/last run/next retry/rate limiter status).

## Versioned API (v1) — API key clients

### `GET /api/v1/posts`

- Auth: `Authorization: Bearer <api_key>`
- Query params: `page`, `limit`, `category`
- Rate limiting: per-minute tier limits; returns `X-RateLimit-*` headers.

### `GET /api/v1/search`

- Auth: `Authorization: Bearer <api_key>`
- Query params: `q` (required), `page`, `limit`
- Rate limiting: per-minute tier limits; returns `X-RateLimit-*` headers.

### `POST /api/v1/generate`

- Auth:
  - `Authorization: Bearer <api_key>`
  - API key must include scope `generate`
  - Subscription tier must be `pro` or `enterprise`
- Body (optional):
  - `category`: `blog` | `news`
  - `topic`: string
- Rate limiting: stricter than read endpoints.

### `POST /api/v1/moderate`

- Auth: requires header `x-api-key` (presence check only)
- Body:
  - `contentId` (string, required)
  - `contentType` (required)
  - `text` (string, required)
  - `authorId` (string, required)
  - `tenantId` (string, optional)
- Returns a moderation decision payload.

## Experimental APIs (`/api/v2/*` and `/api/v3/*`)

These routes exist in the codebase but are **not considered stable**.

By default, mutations are intended to require admin auth. For local development/testing only:

- set `ALLOW_INSECURE_EXPERIMENTAL_APIS=true` to bypass admin-cookie checks in code paths that use `requireInternalExperimental()`.

If you rely on any v2/v3 endpoints, treat them as subject to breaking changes.

