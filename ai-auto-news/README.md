# AI Auto News — Autonomous AI Publishing Platform

AI Auto News is a localhost-first publishing app that can auto-generate posts on a schedule and serve them via a Next.js UI + APIs. Data is stored in a local SQLite database (`data/blog.db`) using `better-sqlite3`.

## Documentation

Start here: [`docs/README.md`](docs/README.md)

## Quick start (localhost)

```bash
cd ai-auto-news
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Admin

Visit `http://localhost:3000/admin` and log in with:

- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `admin123`)

## Notes

- By default, the app can run fully locally using `AI_PROVIDER=mock`.
- To enable live generation, set `AI_PROVIDER=gemini` and provide `GEMINI_API_KEY`.
- SQLite data lives under `data/` and is ignored by git.

