# AI Auto News — Comprehensive Improvement Plan

**Generated:** 2026-06-27
**Scope:** User Experience, Agentic System, Functionality, Error Fixes, UI/UX, Logic Flow
**Project:** `C:\Users\RAVIPRAKASH\Problem_solve\ai-auto-news`

---

## Table of Contents

1. [Critical Error Fixes (Do First)](#1-critical-error-fixes)
2. [Security Hardening](#2-security-hardening)
3. [UI/UX Improvements](#3-uiux-improvements)
4. [Agentic System Improvements](#4-agentic-system-improvements)
5. [Logic Flow & Architecture](#5-logic-flow--architecture)
6. [Functionality Gaps](#6-functionality-gaps)
7. [Code Quality & Technical Debt](#7-code-quality--technical-debt)
8. [Testing & CI](#8-testing--ci)
9. [Execution Roadmap](#9-execution-roadmap)

---

## 1. Critical Error Fixes

### 1.1 Unprotected `JSON.parse` on Database Rows

**Problem:** 7 files in `src/db/` call `JSON.parse()` on database row values without try/catch. Corrupt data crashes the entire request.

**Files affected:**
- `src/db/webhooks.ts:9` — `JSON.parse(row.events || '[]')`
- `src/db/tasks.ts:8` — `JSON.parse(row.payload || '{}')`
- `src/db/posts.ts:8-9`
- `src/db/featureFlags.ts:8`
- `src/db/auditLog.ts:24`
- `src/db/apiKeys.ts:10`
- `src/db/analytics.ts:8`

**Fix:** Create a shared safe-parse helper:
```typescript
// src/db/safeParse.ts
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
```
Replace all `JSON.parse()` calls with `safeJsonParse()`.

---

### 1.2 `new Function()` Code Injection

**Problem:** `src/lib/workflowEngine.ts:486` evaluates arbitrary strings as JavaScript:
```typescript
const func = new Function('context', `return ${condition}`);
return func(context);
```

**Fix:** Replace with a safe expression evaluator. Use a simple property-path accessor for condition checks:
```typescript
function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  // Support only: "context.property === 'value'", "context.property > N", etc.
  const match = condition.match(/^context\.(\w+)\s*(===|!==|>|<|>=|<=)\s*(.+)$/);
  if (!match) return false;
  const [, prop, op, rawVal] = match;
  const left = context[prop];
  const right = JSON.parse(rawVal.trim());
  switch (op) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    default: return false;
  }
}
```

---

### 1.3 Silent Catch Blocks

**Problem:** 6+ files swallow errors with zero logging, making debugging impossible.

**Files:**
- `src/db/auditLog.ts:93`
- `src/db/posts.ts:77, 95, 178`
- `src/components/ArticleEngagementTracker.tsx:33`
- `src/app/search/page.tsx:128`
- `src/lib/autonomousDebuggingEngine.ts:573`

**Fix:** Add debug-level logging to every silent catch:
```typescript
import { logger } from '@/lib/logger';
// ...
catch (err) {
  logger.debug('Non-fatal error in [operation]', { error: err });
}
```

---

### 1.4 `String(err)` in Experimental Routes

**Problem:** 12+ v3 route files use `String(err)` which produces `[object Object]` for non-Error values.

**Fix:** Create a shared error serializer:
```typescript
// src/lib/errorSerializer.ts
export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}
```

---

### 1.5 Broken Docker Build

**Problem:** `Dockerfile` copies `.next/standalone` but `next.config.ts` doesn't set `output: "standalone"`.

**Fix (Option A — recommended for local-first app):**
- Remove the `docker-compose.production.yml` (it references missing files).
- Simplify `Dockerfile` to use standard Next.js build:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/data ./data
EXPOSE 3000
CMD ["npm", "start"]
```

---

### 1.6 RBAC Module Has No Database Persistence

**Problem:** `src/lib/rbac.ts` has 6 TODO comments — all role/permission operations use in-memory stubs.

**Fix:** Either:
- **(A)** Wire RBAC to SQLite (add `roles` and `permissions` tables), or
- **(B)** Remove RBAC from the active codebase and move to `experimental-routes/` since it's not used by the running app.

---

## 2. Security Hardening

### 2.1 Default Credentials

**Problem:** `src/lib/auth.ts:4-6` defaults to `admin`/`admin123` and `default-secret-change-me`. The login page even shows these as hints.

**Fix:**
```typescript
// src/lib/auth.ts
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET, ADMIN_USERNAME, and ADMIN_PASSWORD must be set in production');
  }
  console.warn('⚠ Using default credentials. Set JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD in .env.local');
}
```
Remove the visible credential hint from the login page UI.

---

### 2.2 Admin Cookie Security

**Problem:** `src/app/api/auth/route.ts:22` sets `secure: false`.

**Fix:**
```typescript
secure: process.env.NODE_ENV === 'production',
sameSite: 'strict',
```

---

### 2.3 CSRF Protection

**Problem:** No CSRF protection on admin mutation endpoints.

**Fix:** Add a simple CSRF token flow:
1. On login, generate a CSRF token and set it as a non-httpOnly cookie.
2. On every admin mutation request, require the token in a header (`X-CSRF-Token`).
3. Validate the header matches the cookie.

---

### 2.4 `Math.random()` for ID Generation

**Problem:** 6+ agent files use `Math.random()` for IDs — not cryptographically secure, can collide.

**Fix:** Replace all with `crypto.randomUUID()`:
```typescript
import { randomUUID } from 'crypto';
const id = randomUUID();
```

---

### 2.5 Hardcoded `localhost:3000` URLs

**Problem:** 6 files fall back to `http://localhost:3000` in production paths.

**Fix:** Centralize into a single config:
```typescript
// src/lib/config.ts
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
```
Import from this file everywhere.

---

## 3. UI/UX Improvements

### 3.1 Add Loading Skeletons

**Problem:** No `loading.tsx` or Suspense boundaries. Server-rendered pages show nothing while fetching.

**Fix:** Add `loading.tsx` files for key routes:

```
src/app/loading.tsx              — Global skeleton
src/app/post/[slug]/loading.tsx  — Article skeleton
src/app/category/[slug]/loading.tsx — Category skeleton
```

Example `loading.tsx`:
```tsx
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-[var(--bg-glass)] rounded w-1/3" />
        <div className="h-4 bg-[var(--bg-glass)] rounded w-2/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-64 bg-[var(--bg-glass)] rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

### 3.2 Add Error Boundaries

**Problem:** No `error.tsx` files. Unhandled errors crash the entire page.

**Fix:** Add error boundaries:
```
src/app/error.tsx                — Global error boundary
src/app/post/[slug]/error.tsx    — Article error
src/app/admin/error.tsx          — Admin error
```

```tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 text-center">
      <h2 className="text-xl font-bold mb-4">Something went wrong</h2>
      <p className="text-[var(--text-muted)] mb-6">{error.message}</p>
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  );
}
```

---

### 3.3 Add Custom 404 Page

**Problem:** Relies on Next.js default 404.

**Fix:** Create `src/app/not-found.tsx`:
```tsx
export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 text-center">
      <h1 className="text-6xl font-extrabold gradient-text mb-4">404</h1>
      <p className="text-[var(--text-secondary)] mb-8">Page not found</p>
      <a href="/" className="btn-primary">Go home</a>
    </div>
  );
}
```

---

### 3.4 Fix Admin Auth State on Refresh

**Problem:** Refreshing `/admin` shows the login form even if the JWT cookie is valid.

**Fix:** On mount, call a `/api/auth/verify` endpoint:
```tsx
useEffect(() => {
  fetch('/api/auth/verify').then(r => {
    if (r.ok) setLoggedIn(true);
  });
}, []);
```

Add `src/app/api/auth/verify/route.ts`:
```typescript
export async function GET(req: Request) {
  const token = cookies().get('admin_token')?.value;
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
```

---

### 3.5 Add Skip-to-Content Link

**Problem:** No skip link for keyboard users.

**Fix in `layout.tsx`:**
```tsx
<body>
  <a href="#main-content"
     className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--gradient-primary)] focus:text-white focus:rounded-lg">
    Skip to content
  </a>
  <Header />
  <main id="main-content" className="flex-1">{children}</main>
  <Footer />
</body>
```

---

### 3.6 Add ARIA Live Regions for Dynamic Content

**Problem:** Search results, admin notifications, and generation status update without screen reader announcements.

**Fix:** Add `aria-live="polite"` regions:
```tsx
// Search results
<div aria-live="polite" aria-atomic="true">
  {results.length > 0 && <span className="sr-only">{results.length} results found</span>}
</div>

// Admin notifications
{message && (
  <div role="status" aria-live="polite" className="...">
    {message}
  </div>
)}
```

---

### 3.7 Fix Dashboard Design Inconsistency

**Problem:** `/dashboard` uses hardcoded gray/white colors that clash with the dark-mode design system.

**Fix:** Replace all hardcoded colors with design system variables:
- `bg-gray-50` → `var(--bg-secondary)`
- `bg-white` → `var(--bg-card)`
- `text-gray-900` → `var(--text-primary)`
- `text-gray-600` → `var(--text-secondary)`
- `border-gray-200` → `var(--border-subtle)`

---

### 3.8 Improve Mobile Responsiveness

**Problem:**
- Admin stats grid has no `grid-cols-1` fallback.
- Trust panel is cramped on medium tablets (600-860px).
- Pricing table has no responsive stacking.

**Fix:**
```tsx
// Admin stats — add responsive grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

// Trust panel — add medium breakpoint
@media (max-width: 860px) {
  .trust-panel { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .trust-panel { grid-template-columns: 1fr; }
}
```

---

### 3.9 Add Focus Management for Mobile Menu

**Problem:** Opening/closing the hamburger menu doesn't trap or move focus.

**Fix:**
```tsx
const menuRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (menuOpen && menuRef.current) {
    const firstLink = menuRef.current.querySelector('a');
    firstLink?.focus();
  }
}, [menuOpen]);

// On close, return focus to toggle button
const closeMenu = () => {
  setMenuOpen(false);
  toggleRef.current?.focus();
};
```

---

### 3.10 Debounce ArticleEngagementTracker

**Problem:** Writes to localStorage on every article visit without debouncing.

**Fix:**
```tsx
const writeQueue = useRef<Set<string>>(new Set());
const flushTimeout = useRef<NodeJS.Timeout>();

const trackRead = (slug: string) => {
  writeQueue.current.add(slug);
  clearTimeout(flushTimeout.current);
  flushTimeout.current = setTimeout(() => {
    const existing = JSON.parse(localStorage.getItem('ai-auto-news.reader') || '{}');
    existing.readSlugs = [...new Set([...(existing.readSlugs || []), ...writeQueue.current])];
    localStorage.setItem('ai-auto-news.reader', JSON.stringify(existing));
    writeQueue.current.clear();
  }, 1000);
};
```

---

## 4. Agentic System Improvements

### 4.1 Consolidate Agent Files

**Problem:** 90 agent files in `src/agents/`, but only 4 are actually used (research, blog, news, formatting). The rest are dead scaffolding.

**Action:**
1. Move unused agents to `src/agents/_archived/` (or delete them).
2. Keep only:
   - `researchAgent.ts`
   - `blogAgent.ts`
   - `newsAgent.ts`
   - `formattingAgent.ts`
   - `agentOrchestrator.ts`
   - `autonomousPublisher.ts`
   - `agentMemoryPersistence.ts` (if used by the above)

---

### 4.2 Make Content Strategy Configurable

**Problem:** `autonomousPublisher.ts:23` uses `Math.random() > 0.4` to decide blog vs. news (hardcoded 60/40 split).

**Fix:** Make it configurable via environment variable or database setting:
```typescript
const CONTENT_STRATEGY = process.env.CONTENT_STRATEGY || 'balanced';
// Options: 'blog-heavy', 'news-heavy', 'balanced', 'research-only'
```

---

### 4.3 Add Deduplication Beyond Title Matching

**Problem:** Only avoids recently published *titles*. Same topic can be covered repeatedly with different titles.

**Fix:** Add semantic deduplication:
1. Track published topics (not just titles) in a `published_topics` table.
2. Before generating, check if the topic was covered in the last 7 days.
3. Use tag/category overlap as a secondary signal.

---

### 4.4 Add Quality Gates Before Publishing

**Problem:** All generated content is published immediately with no quality check.

**Fix:** Add a quality scoring step:
```typescript
interface QualityScore {
  readability: number;    // 0-100
  uniqueness: number;     // 0-100
  factualAccuracy: number; // 0-100
  overall: number;        // weighted average
}

function shouldPublish(score: QualityScore): boolean {
  return score.overall >= 60 && score.factualAccuracy >= 50;
}
```
- Posts below threshold go to `draft` status instead of `published`.
- Admin can review and approve drafts.

---

### 4.5 Add Agent Observability

**Problem:** Agent runs are invisible — no logging of what each agent did, how long it took, or what it produced.

**Fix:** Add structured logging to the orchestrator:
```typescript
logger.info('Agent pipeline started', { goal, taskId });
logger.info('Research completed', { topic, duration: researchTime });
logger.info('Content generated', { title, wordCount, duration: generateTime });
logger.info('Pipeline completed', { taskId, totalDuration, status: 'published' });
```

---

### 4.6 Replace Hardcoded Agent Timeouts

**Problem:** Timeouts are magic numbers scattered across files:
- `blogAgent.ts:23` — 60s
- `newsAgent.ts:23` — 45s
- `researchAgent.ts:66` — 30s

**Fix:** Centralize:
```typescript
// src/lib/config.ts
export const AGENT_TIMEOUTS = {
  research: parseInt(process.env.AGENT_TIMEOUT_RESEARCH || '30000'),
  blog: parseInt(process.env.AGENT_TIMEOUT_BLOG || '60000'),
  news: parseInt(process.env.AGENT_TIMEOUT_NEWS || '45000'),
};
```

---

### 4.7 Add Draft/Approval Workflow

**Problem:** No editorial control — everything auto-publishes.

**Fix:** Add a `status` column to posts (`draft`, `pending_review`, `published`, `archived`). Modify the autonomous publisher to create drafts by default, with an option to auto-publish. Add an admin UI section to review and approve drafts.

---

## 5. Logic Flow & Architecture

### 5.1 Fix Admin Page Polling

**Problem:** 30-second `setInterval` polling on the admin page is wasteful and doesn't stop when the tab is hidden.

**Fix:** Use `requestAnimationFrame` + visibility API, or switch to a longer interval with immediate refresh on focus:
```tsx
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 30000);
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') fetchData();
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}, []);
```

---

### 5.2 Fix Recommendation Engine Scalability

**Problem:** `src/app/api/recommendations/route.ts` loads up to 500 posts into memory for scoring on every request.

**Fix:** Move scoring to the database:
1. Pre-compute category/tag vectors on post creation.
2. Use SQLite FTS or a simple cosine similarity in SQL.
3. Cache personalized results per user preference hash (not per request).

---

### 5.3 Fix FTS Index Gaps

**Problem:** `createPost` inserts title, summary, and tags into `posts_fts`, but **content is not indexed** despite the virtual table declaring `content=posts`. No triggers for updates/rebuilds.

**Fix:**
```sql
-- Add content to FTS insert
INSERT INTO posts_fts (title, summary, content, tags) VALUES (?, ?, ?, ?);

-- Add triggers for updates
CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, summary, content, tags)
  VALUES (new.id, new.title, new.summary, new.content, new.tags);
END;

CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content, tags)
  VALUES('delete', old.id, old.title, old.summary, old.content, old.tags);
END;

CREATE TRIGGER posts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, content, tags)
  VALUES('delete', old.id, old.title, old.summary, old.content, old.tags);
  INSERT INTO posts_fts(rowid, title, summary, content, tags)
  VALUES (new.id, new.title, new.summary, new.content, new.tags);
END;
```

---

### 5.4 Normalize API Response Shapes

**Problem:** SDKs expect `{ success, data }` but routes return `{ posts, total, page }` or raw objects.

**Fix:** Create a response wrapper:
```typescript
// src/lib/apiResponse.ts
export function apiSuccess<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json({ success: true, data, ...meta });
}
export function apiError(message: string, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status });
}
```
Gradually migrate all v1 routes to use this.

---

### 5.5 Centralize Configuration

**Problem:** Magic numbers, timeouts, URLs, and feature flags are scattered across 100+ files.

**Fix:** Create a single config module:
```typescript
// src/lib/config.ts
export const config = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  aiProvider: process.env.AI_PROVIDER || 'mock',
  geminiApiKey: process.env.GEMINI_API_KEY,
  schedulerInterval: parseInt(process.env.SCHEDULER_INTERVAL || '7200000'),
  agentTimeouts: {
    research: parseInt(process.env.AGENT_TIMEOUT_RESEARCH || '30000'),
    blog: parseInt(process.env.AGENT_TIMEOUT_BLOG || '60000'),
    news: parseInt(process.env.AGENT_TIMEOUT_NEWS || '45000'),
  },
  contentStrategy: process.env.CONTENT_STRATEGY || 'balanced',
  rateLimits: {
    api: parseInt(process.env.RATE_LIMIT_API || '100'),
    search: parseInt(process.env.RATE_LIMIT_SEARCH || '200'),
  },
} as const;
```

---

## 6. Functionality Gaps

### 6.1 Add `loading.tsx` for All Server Routes

Add skeleton loading states for:
- `/` (home)
- `/post/[slug]`
- `/category/[category]`
- `/about`
- `/pricing`

---

### 6.2 Add `error.tsx` for All Routes

Add error boundaries for all App Router pages.

---

### 6.3 Wire Up RBAC to SQLite

Implement the 6 TODO items in `src/lib/rbac.ts` with actual database operations.

---

### 6.4 Complete v1 API Coverage

Missing v1 endpoints that SDKs expect:
- `GET /api/v1/apikeys` — list API keys
- `DELETE /api/v1/apikeys/:id` — revoke API key
- `GET /api/v1/webhooks` — list webhooks
- `DELETE /api/v1/webhooks/:id` — delete webhook
- `GET /api/v1/subscriptions/current` — current subscription

---

### 6.5 Add Search Content Indexing

FTS5 currently doesn't index article content. Fix the insert/update statements and add triggers.

---

### 6.6 Add Database Migrations

Replace implicit `CREATE TABLE IF NOT EXISTS` with versioned migration scripts:
```
src/db/migrations/
  001_initial_schema.sql
  002_add_fts_triggers.sql
  003_add_draft_status.sql
```

---

## 7. Code Quality & Technical Debt

### 7.1 Replace `console.*` with Structured Logger

**164 console calls across 48 files.** The project already has `src/lib/logger.ts`.

**Action:** Replace all `console.log/error/warn` in:
- `src/scheduler/autoPublisher.ts` (10 calls)
- `src/agents/advancedOrchestrator.ts` (8 calls)
- `src/agents/autonomousPublisher.ts` (7 calls)
- `src/agents/blogAgent.ts` (6 calls)
- `src/agents/newsAgent.ts` (6 calls)
- `src/agents/researchAgent.ts` (7 calls)
- All `src/app/api/` routes (30+ calls)

---

### 7.2 Fix TypeScript/Lint Exclusions

**Problem:** `tsconfig.json` excludes `src/agents`, `src/lib`. `eslint.config.mjs` ignores them too. 373 files are unchecked.

**Action (incremental):**
1. Start with files imported by `src/app/`, `src/db/`, `src/scheduler/`.
2. Fix type errors in those files.
3. Remove them from the exclusion list.
4. Repeat until core runtime is covered.

---

### 7.3 Fix Deprecated Dependencies

| Package | Action |
|---------|--------|
| `@apollo/server` v4 | Upgrade to v5 or remove if unused |
| `passport-azure-ad` | Remove (deprecated, not wired into app) |
| `glob` (old) | Upgrade to v10+ |
| `inflight` | Remove (memory leak) |
| `abab` | Replace with native `atob()`/`btoa()` |

---

### 7.4 Remove Unused Dependencies

These are installed but not used by the running app:
- `@apollo/server`, `graphql` — no GraphQL endpoint is wired
- `passport-azure-ad` — SSO not implemented
- `saml2-js` — SAML not implemented
- `bullmq`, `ioredis` — task queue not wired
- `stripe` — payments not wired
- `@prisma/client` — Prisma not used at runtime
- `@types/nodemailer`, `@types/pg` — no nodemailer or pg usage

---

### 7.5 Clean Up `as any` and `@ts-ignore`

- 50+ `as any` in production code — gradually type properly.
- 3 `@ts-ignore` in `src/lib/sso.ts` — add proper type declarations for `saml2-js`.

---

## 8. Testing & CI

### 8.1 Fix Jest Configuration

- Move `ts-jest` config out of deprecated `globals` field.
- Remove `forceExit` by cleaning up timers/intervals in `afterEach`.
- Add silent logger for test environment.

---

### 8.2 Add Route Integration Tests

Test the core API endpoints:
- `POST /api/auth` — login/logout
- `GET /api/posts` — list posts
- `GET /api/posts/[slug]` — single post
- `GET /api/search` — search
- `POST /api/generate` — trigger generation
- `GET /api/v1/posts` — public API
- `POST /api/apikeys` — API key management

---

### 8.3 Add CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

---

## 9. Execution Roadmap

### Phase 1: Critical Fixes (Days 1-3)
1. Fix `JSON.parse` safety in `src/db/` (7 files)
2. Fix `new Function()` injection in `workflowEngine.ts`
3. Fix default credentials — fail in production
4. Fix admin cookie `secure` flag
5. Fix Dockerfile/build mismatch
6. Add `error.tsx` and `not-found.tsx`

### Phase 2: UI/UX Quick Wins (Days 4-7)
7. Add `loading.tsx` skeletons for all routes
8. Fix admin auth state on refresh
9. Add skip-to-content link
10. Fix dashboard design inconsistency
11. Add ARIA live regions
12. Fix mobile responsiveness gaps
13. Debounce ArticleEngagementTracker

### Phase 3: Agentic System (Days 8-14)
14. Archive unused agent files
15. Make content strategy configurable
16. Add quality gates before publishing
17. Add agent observability/logging
18. Centralize agent timeouts
19. Add draft/approval workflow

### Phase 4: Logic Flow (Days 15-21)
20. Fix FTS index gaps (add content, add triggers)
21. Fix recommendation engine scalability
22. Normalize API response shapes
23. Centralize configuration
24. Fix admin polling behavior

### Phase 5: Code Quality (Days 22-30)
25. Replace `console.*` with logger (48 files)
26. Fix silent catch blocks
27. Replace `Math.random()` with `crypto.randomUUID()`
28. Fix `String(err)` in experimental routes
29. Remove unused dependencies
30. Begin TypeScript exclusion cleanup

### Phase 6: Testing & CI (Days 31-35)
31. Fix Jest configuration
32. Add route integration tests
33. Set up CI pipeline
34. Fix RBAC database persistence

### Phase 7: Polish (Days 36-40)
35. Add database migrations
36. Complete v1 API coverage
37. Normalize SDK/CLI contracts
38. Clean up deprecated dependencies
39. Documentation cleanup

---

## Summary

| Category | Items | Priority |
|----------|-------|----------|
| Critical Error Fixes | 6 | 🔴 Do first |
| Security Hardening | 5 | 🔴 Do first |
| UI/UX Improvements | 10 | 🟡 Quick wins |
| Agentic System | 7 | 🟠 Core improvement |
| Logic Flow | 5 | 🟠 Core improvement |
| Functionality Gaps | 6 | 🟡 Incremental |
| Code Quality | 5 | 🟢 Technical debt |
| Testing & CI | 4 | 🟢 Foundation |

**Total actionable items: 48**

The project has a solid foundation — it builds, 604 tests pass, and the core publishing pipeline works. The biggest wins come from fixing the critical errors (Phase 1), improving the UI/UX with loading/error states (Phase 2), and making the agentic system observable and configurable (Phase 3). Everything else is incremental improvement.
