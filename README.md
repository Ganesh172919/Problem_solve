# Problem Solve — AI Auto News Repository

Welcome to the **Problem Solve** repository. The primary application in this repository is **AI Auto News** (`/ai-auto-news`), an autonomous AI-powered publishing platform built with Next.js, TypeScript, SQLite, and Gemini AI.

---

## 📁 Repository Structure

```
Problem_solve/
├── ai-auto-news/                     # Primary Project: AI Publishing Platform
│   ├── src/                          # Next.js App Router, API routes, components, agent pipeline
│   ├── cli/                          # Command-line interface tool
│   ├── sdk/                          # Client SDKs (TypeScript, Python, Go)
│   ├── docs/                         # Comprehensive documentation hub
│   ├── tests/                        # Unit and integration test suites
│   ├── docker-compose.yml            # Local & production container orchestration
│   └── package.json                  # Dependencies & scripts
├── COMPREHENSIVE_IMPROVEMENT_PLAN.md  # Architectural roadmap & system improvements
├── IMPROVEMENT_PLAN.txt               # Key priorities & optimization notes
└── README.md                         # Repository documentation (this file)
```

---

## ⚡ AI Auto News — Quick Start

### Prerequisites
- **Node.js**: 18.x or higher
- **npm**: 9.x or higher

### 1. Installation & Environment Setup

```bash
# Navigate to the project directory
cd ai-auto-news

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env.local
```

> 💡 **Default Mode:** By default, `AI_PROVIDER=mock` is active so the application functions 100% offline out-of-the-box without requiring an external API key.

### 2. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the platform.

---

## ✨ Key Features (AI Auto News)

- 🤖 **Autonomous AI Content Pipeline**: Research $\to$ Generation $\to$ Formatting $\to$ Automated Publishing.
- 🔄 **Background Scheduler & Task Queue**: Configurable auto-publishing intervals with SQLite/BullMQ task queue execution.
- 🔍 **Full-Text Search (FTS5)**: Fast article search with keyword highlighting and category filtering.
- 🛡️ **Admin Dashboard**: Full administrative control over articles, manual triggers, scheduler toggles, and system statistics.
- ⚡ **Localhost-First SQLite Storage**: Zero-configuration local database using `better-sqlite3` with WAL mode.
- 🎨 **Modern Dark-Mode UI**: Glassmorphism cards, responsive navigation, staggered fade-in animations, and Google Inter typography.
- 🔑 **Multi-Format API**: REST (v1, v2, v3), GraphQL endpoint (`/api/graphql`), and exporter tools (JSON/TXT).
- 🛠️ **CLI & Multi-Language SDKs**: Command line tools and client libraries for TypeScript, Python, and Go.

---

## 📚 Documentation Links

| Resource | Description |
|----------|-------------|
| 📖 [`ai-auto-news/README.md`](ai-auto-news/README.md) | Full AI Auto News project documentation |
| 🚀 [`ai-auto-news/docs/getting-started.md`](ai-auto-news/docs/getting-started.md) | Getting started & step-by-step setup guide |
| 🏛️ [`ai-auto-news/docs/architecture.md`](ai-auto-news/docs/architecture.md) | System architecture & content pipeline overview |
| ⚙️ [`ai-auto-news/docs/configuration.md`](ai-auto-news/docs/configuration.md) | Complete environment configuration reference |
| 🔌 [`ai-auto-news/docs/api.md`](ai-auto-news/docs/api.md) | REST API & GraphQL endpoint reference |
| 🖥️ [`ai-auto-news/docs/cli.md`](ai-auto-news/docs/cli.md) | CLI commands & usage guide |
| 📦 [`ai-auto-news/docs/sdk.md`](ai-auto-news/docs/sdk.md) | TypeScript, Python, and Go SDK documentation |
| 🚢 [`ai-auto-news/docs/deployment.md`](ai-auto-news/docs/deployment.md) | Docker & container deployment guide |
| 🔧 [`ai-auto-news/docs/troubleshooting.md`](ai-auto-news/docs/troubleshooting.md) | Common issues & diagnostic steps |
| 📋 [`COMPREHENSIVE_IMPROVEMENT_PLAN.md`](COMPREHENSIVE_IMPROVEMENT_PLAN.md) | Codebase roadmap & improvement plans |

---

## 🧪 Running Tests & Scripts

```bash
cd ai-auto-news

# Run Jest unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate test coverage report
npm run test:coverage

# Run smoke test script
npm run smoke
```

---

## 📜 License

This repository is maintained for local development, research, and publishing automation experiments.

