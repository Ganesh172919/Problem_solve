# 🤖 AI Auto News — Autonomous AI Publishing Platform

An autonomous AI-powered blog and news platform that researches trending topics, generates high-quality content, and publishes automatically every 5 minutes. Built with Next.js, Gemini API, Perplexity API, and SQLite.

## Overview

AI Auto News is a self-operating AI publishing engine that:

- **Collects** real-world information via the Perplexity API
- **Researches** trending AI and tech topics
- **Generates** formatted blog posts and news articles via the Gemini API
- **Automatically posts** new content every 5 minutes
- **Saves** everything to a SQLite database
- **Publishes** to a clean, SEO-optimized frontend
- **Runs entirely** on localhost — no Docker, no CI/CD, no external services

## 🏗 Architecture

```
┌─────────────────────────────────────────────────┐
│                  Next.js App Router              │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ Research  │───▶│   Blog   │    │   News   │  │
│  │  Agent    │    │  Agent   │    │  Agent   │  │
│  │(Perplexity│    │ (Gemini) │    │ (Gemini) │  │
│  └──────────┘    └────┬─────┘    └────┬─────┘  │
│                       │               │         │
│                  ┌────▼───────────────▼─────┐   │
│                  │    Formatting Agent       │   │
│                  └────────────┬──────────────┘   │
│                               │                  │
│                  ┌────────────▼──────────────┐   │
│                  │  Autonomous Publisher      │   │
│                  │  (Scheduler / setInterval) │   │
│                  └────────────┬──────────────┘   │
│                               │                  │
│                  ┌────────────▼──────────────┐   │
│                  │     SQLite Database        │   │
│                  └───────────────────────────┘   │
│                                                  │
│  Frontend: Homepage │ Post │ Category │ Admin    │
└─────────────────────────────────────────────────┘
```

## 🤖 Agent Workflow

1. **Research Agent** queries Perplexity API for trending AI/tech topics
2. **Autonomous Publisher** decides whether to generate a blog or news article
3. **Blog Agent** or **News Agent** generates structured content via Gemini API
4. **Formatting Agent** cleans and standardizes HTML output
5. Content is saved to SQLite with unique slug and SEO metadata
6. Frontend displays posts with pagination, categories, and full SEO

## ⏱ Automation Workflow

- The auto-publisher starts automatically on app boot
- Runs every 5 minutes using `setInterval` in server context
- Includes lock mechanism to prevent duplicate execution
- Survives hot reloads via `globalThis` singleton
- Retries once on failure, skips cycle if APIs unavailable
- Prevents duplicate topics using recent topic memory

## 📁 Folder Structure

```
ai-auto-news/
├── package.json
├── .env.example
├── README.md
├── next.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with Header/Footer
│   │   ├── page.tsx            # Homepage with post grid
│   │   ├── globals.css         # Global styles
│   │   ├── about/page.tsx      # About page
│   │   ├── admin/page.tsx      # Admin dashboard (client component)
│   │   ├── post/[slug]/page.tsx       # Individual post page
│   │   ├── category/[category]/page.tsx # Category filter page
│   │   ├── sitemap.xml/route.ts       # Dynamic sitemap
│   │   ├── robots.txt/route.ts        # robots.txt
│   │   └── api/
│   │       ├── auth/route.ts          # JWT login
│   │       ├── posts/route.ts         # List posts
│   │       ├── posts/[slug]/route.ts  # Get/Delete post
│   │       ├── generate/route.ts      # Manual content generation
│   │       ├── scheduler/route.ts     # Scheduler status/toggle
│   │       └── admin/route.ts         # Admin stats
│   ├── agents/
│   │   ├── researchAgent.ts           # Perplexity API integration
│   │   ├── blogAgent.ts               # Gemini blog generation
│   │   ├── newsAgent.ts               # Gemini news generation
│   │   ├── formattingAgent.ts         # HTML formatting/sanitization
│   │   └── autonomousPublisher.ts     # Core automation engine
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── PostCard.tsx
│   │   └── Pagination.tsx
│   ├── db/
│   │   ├── index.ts            # SQLite connection & schema
│   │   └── posts.ts            # Post CRUD operations
│   ├── lib/
│   │   ├── auth.ts             # JWT/bcrypt authentication
│   │   └── scheduler-init.ts   # One-time scheduler initialization
│   ├── scheduler/
│   │   └── autoPublisher.ts    # setInterval scheduler with lock
│   └── types/
│       └── index.ts            # TypeScript type definitions
├── public/
└── data/                       # SQLite DB (auto-created, gitignored)
```

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
cd ai-auto-news
npm install
```

### Environment Variables

Create a `.env.local` file in the `ai-auto-news` directory:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your API keys:

```env
# Gemini API Key - https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Perplexity API Key - https://www.perplexity.ai/settings/api
PERPLEXITY_API_KEY=your_perplexity_api_key_here

# JWT Secret - Any random string
JWT_SECRET=your_jwt_secret_here_change_this

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

> **Note:** The app works without API keys using built-in fallback content generators. Add real API keys for live AI-generated content.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the auto-publisher starts automatically.

## 🔐 Admin Access

Navigate to [http://localhost:3000/admin](http://localhost:3000/admin) and log in with:

- **Username:** admin (or as set in `ADMIN_USERNAME`)
- **Password:** admin123 (or as set in `ADMIN_PASSWORD`)

Admin features:
- View total posts and auto-generated count
- See last generation time and scheduler status
- Manually trigger content generation
- Pause/resume automation
- Delete posts

## 🔍 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Optional* | Google Gemini API key for content generation |
| `PERPLEXITY_API_KEY` | Optional* | Perplexity API key for research |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens |
| `ADMIN_USERNAME` | Yes | Admin login username |
| `ADMIN_PASSWORD` | Yes | Admin login password |

*Without API keys, fallback content generators are used.

## 🛠 Troubleshooting

| Issue | Solution |
|---|---|
| `better-sqlite3` build error | Run `npm rebuild better-sqlite3` |
| Database not created | Ensure the app has write permissions to the project directory |
| Posts not generating | Check console logs for API errors; verify API keys |
| Admin login fails | Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env.local` |
| Port 3000 in use | Use `PORT=3001 npm run dev` |

## 🚀 Future Scaling Roadmap (Documentation Only)

These are not implemented but show how the platform can evolve:

1. **Replace interval with job queue** — Use BullMQ or similar for reliable job processing
2. **Use Redis** — For caching, session storage, and pub/sub between services
3. **Add vector memory** — Store embeddings of past content for better deduplication and topic diversity
4. **Add monetization** — Integrate ad networks or subscription paywalls
5. **Deploy to cloud** — Vercel, AWS, or GCP with managed databases
6. **Use serverless cron** — Vercel Cron Jobs, AWS EventBridge, or CloudWatch Events
7. **Add analytics** — Track page views, engagement, and content performance
8. **Multi-model support** — Add Claude, GPT-4, or other LLMs as content generators
9. **Content review pipeline** — Add human-in-the-loop review before publishing
10. **API rate limiting** — Implement proper rate limiting for production use
