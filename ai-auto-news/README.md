# AI Auto News — Autonomous AI Publishing Platform

🤖 An autonomous AI-powered publishing platform that researches trending topics, generates content, and publishes automatically. Runs fully locally with zero external dependencies.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🧠 **AI Content Generation** | Automated research → blog/news generation pipeline using Gemini AI |
| 🔄 **Auto-Publishing** | Background scheduler generates and publishes content on a configurable interval |
| 🎭 **Mock AI Mode** | Works 100% offline with built-in mock content generation (no API key needed) |
| 🔍 **Full-Text Search** | FTS5-powered search across all articles with highlighted results |
| 📂 **Category System** | Filter posts by category (Blog, News, Tech, AI, etc.) |
| 📥 **Export** | Download articles as JSON or TXT files via `/api/export` |
| 🛡️ **Admin Dashboard** | Manage posts, trigger generation, toggle scheduler, view stats |
| 📱 **Responsive Design** | Premium dark-mode UI with glassmorphism, animations, and mobile support |
| ⚡ **SQLite Storage** | Zero-config local database with WAL mode for fast reads |
| 🔐 **Security** | XSS sanitization, CSP headers, CSRF protection, rate limiting |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ 
- **npm** 9+

### Setup

```bash
# 1. Navigate to the project
cd ai-auto-news

# 2. Install dependencies
npm install

# 3. Create environment config
cp .env.example .env.local

# 4. Start the dev server
npm run dev
```

Open **http://localhost:3000** in your browser.

> 💡 The app works immediately with `AI_PROVIDER=mock` (default) — no API key needed!

---

## 🔑 Configuration

Edit `.env.local` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `mock` | Set to `gemini` for real AI generation |
| `GEMINI_API_KEY` | (empty) | Your Gemini API key (required when `AI_PROVIDER=gemini`) |
| `ADMIN_USERNAME` | `admin` | Admin panel login username |
| `ADMIN_PASSWORD` | `admin123` | Admin panel login password |
| `SCHEDULER_ENABLED` | `true` | Enable/disable auto-publishing scheduler |
| `SCHEDULER_INTERVAL_MS` | `7200000` | Auto-publish interval (default: 2 hours) |

---

## 📖 Usage

### Web Interface

| Page | URL | Description |
|------|-----|-------------|
| **Home** | `/` | Browse all articles with stats and daily headlines |
| **Category** | `/category/blog` | Filter by category |
| **Search** | `/search` | Full-text search with highlighted results |
| **Post** | `/post/[slug]` | Read full article with reading time |
| **Admin** | `/admin` | Dashboard to manage posts and scheduler |

### API Endpoints

```bash
# List posts
GET /api/posts?limit=10&page=1

# Search
GET /api/search?q=artificial+intelligence

# Export as JSON
GET /api/export?format=json&category=blog&limit=50

# Export as TXT
GET /api/export?format=txt

# Generate content (admin)
POST /api/generate

# Toggle scheduler (admin)
POST /api/scheduler
```

---

## 🏗️ Architecture

```
ai-auto-news/
├── src/
│   ├── app/              # Next.js App Router pages & API routes
│   │   ├── api/          # REST API endpoints (26 route groups)
│   │   ├── admin/        # Admin dashboard
│   │   ├── search/       # Full-text search page
│   │   ├── category/     # Category filtering
│   │   └── post/         # Article detail view
│   ├── agents/           # AI agent pipeline
│   │   ├── researchAgent     # Topic research (Gemini or mock)
│   │   ├── blogAgent         # Blog post generation
│   │   ├── newsAgent         # News article generation
│   │   ├── formattingAgent   # HTML formatting & sanitization
│   │   ├── autonomousPublisher  # End-to-end orchestrator
│   │   └── mockAi            # Offline mock AI provider
│   ├── components/       # React components (Header, Footer, PostCard, etc.)
│   ├── db/               # SQLite database layer (better-sqlite3)
│   ├── lib/              # Utilities (config, auth, rate limiter, etc.)
│   ├── scheduler/        # Background auto-publisher
│   ├── types/            # TypeScript type definitions
│   └── workers/          # Task queue workers
├── data/                 # SQLite database files (auto-created)
├── docs/                 # Documentation
└── tests/                # Unit tests (Jest)
```

### Content Pipeline

```
Research → Generate → Format → Save to SQLite
   ↑                                    ↓
   └── Scheduler (runs every 2 hours) ←─┘
```

---

## 🎨 Design

The UI features a **premium dark-mode design** with:
- 🌙 Deep dark backgrounds with glass-morphism cards
- 🎨 Purple/blue gradient accents and animated text
- ✨ Staggered fade-in animations on post grids
- 📱 Fully responsive with mobile hamburger menu
- 🔤 Inter font from Google Fonts
- 🏷️ Color-coded category badges
- ⏱️ Reading time estimates on all articles

---

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

---

## 📝 Notes

- The app runs fully locally using SQLite — no external database required
- Data is stored in `data/blog.db` (auto-created on first run)
- Set `AI_PROVIDER=gemini` and provide `GEMINI_API_KEY` for real AI generation
- The scheduler generates content automatically — check the admin dashboard for status
- All content is sanitized against XSS via DOMPurify
