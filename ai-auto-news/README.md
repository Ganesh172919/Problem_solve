# AI Auto News — Autonomous AI Publishing Platform (v2.0.0)

🤖 An autonomous, full-stack AI-powered publishing platform that researches trending topics, generates engaging content, formats HTML, and publishes automatically. Built with Next.js 16, React 19, SQLite, Prisma, and Gemini AI. Works 100% locally out-of-the-box with zero external dependencies.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🧠 **AI Content Generation** | Autonomous research $\to$ article generation pipeline using Gemini AI (with mock fallback) |
| 🔄 **Auto-Publishing Scheduler** | Background scheduler generates and publishes articles on configurable time intervals |
| 🎭 **Mock AI Mode** | Works 100% offline using built-in mock AI provider — no API keys required |
| 🔍 **Full-Text Search (FTS5)** | SQLite FTS5-powered instant article search with term highlighting |
| 📂 **Category System** | Organize & filter posts by categories (Blog, News, Tech, AI, Science, etc.) |
| 🛡️ **Admin Dashboard** | Manage articles, manually trigger generation, toggle scheduler, and view system metrics |
| 📥 **Multi-Format Export** | Download articles via `/api/export` in JSON or TXT formats |
| 📱 **Modern Dark-Mode UI** | Glassmorphism cards, staggered animations, mobile responsiveness, & Google Inter font |
| 🔑 **Multi-Protocol APIs** | REST endpoints (v1, v2, v3) + GraphQL endpoint at `/api/graphql` |
| 🛠️ **CLI & Multi-Language SDKs** | Command-line management tool + client SDKs for TypeScript, Python, and Go |
| 📊 **Observability & Metrics** | OpenTelemetry tracing and Prometheus metrics endpoint (`prom-client`) |
| 🔐 **Enterprise Security** | XSS sanitization (DOMPurify), CSP headers, CSRF protection, rate limiting, & JWT/OAuth support |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18.x+ 
- **npm** 9.x+

### Setup & Launch

```bash
# 1. Navigate to project directory
cd ai-auto-news

# 2. Install dependencies
npm install

# 3. Initialize local environment config
cp .env.example .env.local

# 4. Start development server
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

> 💡 **Offline Ready:** The app defaults to `AI_PROVIDER=mock` so you can test all publishing features immediately without a Gemini API key.

---

## 🔑 Environment Configuration

Edit `.env.local` to customize settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `mock` | Set to `gemini` for real AI content generation |
| `GEMINI_API_KEY` | *(empty)* | Your Gemini API key (required when `AI_PROVIDER=gemini`) |
| `ADMIN_USERNAME` | `admin` | Admin dashboard login username |
| `ADMIN_PASSWORD` | `admin123` | Admin dashboard login password |
| `SCHEDULER_ENABLED` | `true` | Enable/disable auto-publishing scheduler |
| `SCHEDULER_INTERVAL_MS` | `7200000` | Auto-publish interval in milliseconds (default: 2 hours) |
| `DATABASE_URL` | `file:./data/blog.db` | SQLite database file location |
| `REDIS_URL` | *(empty)* | Optional Redis connection URL for BullMQ queues |

---

## 📖 Available NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js development server on port 3000 |
| `npm run build` | Create optimized production build |
| `npm run start` | Run production server |
| `npm run test` | Run Jest unit tests |
| `npm run test:watch` | Run Jest tests in interactive watch mode |
| `npm run test:coverage` | Run Jest tests with coverage reporting |
| `npm run smoke` | Run local automated smoke test script |
| `npm run prisma:generate` | Generate Prisma client code |
| `npm run prisma:migrate` | Run database migrations in development |
| `npm run docker:build` | Build application Docker image |
| `npm run docker:up` | Launch local stack via Docker Compose |
| `npm run docker:down` | Stop Docker Compose stack |

---

## 🌐 Web Routes & API Overview

### Web Pages
- **Home (`/`)**: Latest published articles, featured posts, and statistics banner
- **Post Detail (`/post/[slug]`)**: Full article reading view with estimated reading time
- **Category Filter (`/category/[category]`)**: Filter articles by topic category
- **Search (`/search`)**: Interactive full-text search page with highlighted hits
- **Admin Dashboard (`/admin`)**: Publishing stats, manual content triggers, and post management

### REST & GraphQL Endpoints
- `GET /api/posts` — Retrieve paginated articles list
- `GET /api/search?q={query}` — Full-text search endpoint
- `GET /api/export?format=json` — Export posts as JSON or TXT
- `POST /api/generate` — Trigger immediate AI article generation (Admin)
- `POST /api/scheduler` — Toggle background scheduler state (Admin)
- `POST /api/graphql` — GraphQL query and mutation interface
- `GET /api/v1/*` — Stable v1 REST API for API key clients

---

## 🖥️ CLI Tool & SDKs

### Command-Line Tool (`cli/`)
Manage the platform directly from the terminal:

```bash
# Run CLI tool
node cli/index.js status
node cli/index.js generate --category=tech
node cli/index.js list-posts --limit=5
```

### Client SDKs (`sdk/`)
Client SDKs are available for integration:
- 🟦 **TypeScript SDK**: `sdk/typescript`
- 🐍 **Python SDK**: `sdk/python`
- 🐹 **Go SDK**: `sdk/go`

---

## 🏗️ Project Architecture

```
ai-auto-news/
├── src/
│   ├── app/              # Next.js App Router pages, layouts, and API routes
│   │   ├── api/          # REST & GraphQL API endpoints
│   │   ├── admin/        # Admin control panel
│   │   ├── search/       # Full-text search interface
│   │   ├── category/     # Category-filtered post pages
│   │   └── post/         # Article detail view
│   ├── agents/           # Multi-agent AI generation pipeline
│   │   ├── researchAgent         # Topic research & trend discovery
│   │   ├── blogAgent             # Long-form blog generator
│   │   ├── newsAgent             # Breaking news generator
│   │   ├── formattingAgent       # HTML formatting & DOMPurify sanitization
│   │   ├── autonomousPublisher   # End-to-end orchestration agent
│   │   └── mockAi                # Offline mock AI provider
│   ├── components/       # Reusable UI components (Header, Footer, PostCard, etc.)
│   ├── db/               # SQLite database client (`better-sqlite3`) & queries
│   ├── lib/              # Utilities (auth, logger, rate limiter, feature flags)
│   ├── scheduler/        # Background auto-publisher timer loop
│   ├── types/            # TypeScript type definitions
│   └── workers/          # Background task queue & worker handlers
├── cli/                  # Command line interface tool
├── data/                 # SQLite database storage directory (`blog.db`)
├── docs/                 # Detailed documentation hub
├── sdk/                  # Client SDK libraries (TS, Python, Go)
└── tests/                # Jest unit & integration test suites
```

---

## 📚 Documentation Hub

For detailed guides, refer to the documentation hub in `docs/`:

- 🚀 [Getting Started Guide](docs/getting-started.md)
- ⚙️ [Configuration Guide](docs/configuration.md)
- 🏛️ [Architecture Documentation](docs/architecture.md)
- 🔌 [API Reference](docs/api.md)
- 🖥️ [CLI Documentation](docs/cli.md)
- 📦 [SDK Documentation](docs/sdk.md)
- 🚢 [Deployment Guide](docs/deployment.md)
- 🔧 [Troubleshooting Guide](docs/troubleshooting.md)
- 📊 [Platform Overview](PLATFORM_OVERVIEW.md)
- 📜 [Platform Documentation](PLATFORM_DOCUMENTATION.md)
- 🎯 [Vision & Roadmap](VISION.md)

---

## 🧪 Testing

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for details.

