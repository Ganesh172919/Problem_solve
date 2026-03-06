# Configuration

This app reads configuration from environment variables. Start from:

```bash
cp .env.example .env.local
```

## Environment variables

| Variable | Default (from `.env.example`) | Required | Purpose |
|---|---:|:---:|---|
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | No | Used for absolute links (RSS/sitemap/robots). If unset, derived from request host. |
| `AI_PROVIDER` | `mock` | No | AI provider mode: `mock` (fully local) or `gemini` (live generation). |
| `GEMINI_API_KEY` | empty | Only for `AI_PROVIDER=gemini` | Google Gemini API key used by agents (research/generation). |
| `JWT_SECRET` | `dev-secret-change-me` | Yes (change for prod) | Secret used to sign/verify the admin cookie token. |
| `ADMIN_USERNAME` | `admin` | Yes | Admin username for the `/admin` UI login. |
| `ADMIN_PASSWORD` | `admin123` | Yes | Admin password for the `/admin` UI login. |
| `SCHEDULER_ENABLED` | `true` | No | Enables background auto-publishing scheduler at runtime. |
| `TASK_QUEUE_ENABLED` | `true` | No | Enables background task queue worker at runtime. |
| `SCHEDULER_INTERVAL_MS` | `7200000` | No | Scheduler interval (ms). Default: 2 hours. |
| `TASK_QUEUE_INTERVAL_MS` | `10000` | No | Task queue poll interval (ms). Default: 10 seconds. |
| `ALLOW_INSECURE_EXPERIMENTAL_APIS` | `false` | No | When `true`, allows experimental `/api/v2/*` and `/api/v3/*` mutation endpoints without admin cookie (for local dev only). |
| `LOG_LEVEL` | `info` | No | Logging verbosity. |

## AI provider modes

### `AI_PROVIDER=mock` (default)

- No external network calls for content generation.
- Agents return safe placeholder content.

### `AI_PROVIDER=gemini`

- Requires `GEMINI_API_KEY`.
- The app uses an in-process, shared rate limiter to avoid exceeding daily quota.
- If `AI_PROVIDER=gemini` is set but the key is missing, the app falls back to mock mode.

## Background services (scheduler + task queue)

Background services are started **only at runtime** (`next dev` / `next start`), and are automatically disabled during:

- Next.js build-like phases
- test runs (Jest/Vitest)

The entry point is `src/lib/scheduler-init.ts`, which is invoked on the first runtime request to some routes (for example `GET /api/posts`).

