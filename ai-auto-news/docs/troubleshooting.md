# Troubleshooting

## Admin endpoints return `401 Unauthorized`

- You must log in via the `/admin` page or `POST /api/auth`.
- A successful login sets an `admin_token` cookie.
- Ensure `JWT_SECRET` is set (change it for production).

## `/api/posts` works but background automation never runs

Background services are disabled automatically during builds/tests. They start only at runtime.

Check:

- `SCHEDULER_ENABLED=true`
- `TASK_QUEUE_ENABLED=true`

Also note: the scheduler/task queue are initialized lazily by some routes at runtime (for example `GET /api/posts`).

## Gemini is configured but generation looks like placeholders

If `AI_PROVIDER=gemini` but `GEMINI_API_KEY` is missing/blank, the app falls back to mock mode.

Verify `.env.local` has a real key:

- `AI_PROVIDER=gemini`
- `GEMINI_API_KEY=...`

## Gemini rate limiting / quota exhausted

The app uses a shared, in-process rate limiter for Gemini requests.

Symptoms:

- scheduler cycles are skipped
- responses mention quota / retry delays

Mitigations:

- increase `SCHEDULER_INTERVAL_MS`
- switch to `AI_PROVIDER=mock` for local development

## SQLite “database is locked” or WAL/shm issues

Stop all running app processes and retry. If needed, reset local data:

- delete `ai-auto-news/data/blog.db*`
- restart `npm run dev`

## v1 API calls fail with “Missing Authorization header”

v1 read/generate endpoints expect:

- `Authorization: Bearer aian_...`

If you don’t have a key yet, follow [API bootstrap](api.md#local-bootstrap-for-v1-api-key-testing).

## `POST /api/v1/generate` returns `403`

This endpoint is gated:

- tier must be `pro` or `enterprise`
- API key must have scope `generate`

For local development, you can mint a key with `--scopes read,generate`, but you must also ensure the user’s `tier` is set accordingly in the DB.

