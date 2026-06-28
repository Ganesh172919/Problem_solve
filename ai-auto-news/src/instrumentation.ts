// ─────────────────────────────────────────────────────────────────────────────
// Next.js instrumentation hook — runs once on server boot.
// Validates config and starts the background scheduler.
//
// WHY here (not in page.tsx):
//  - instrumentation.ts runs exactly once per process, before any request
//  - page.tsx runs on every request (even with the global guard, it's fragile)
//  - Next.js 14+ supports this hook natively
// ─────────────────────────────────────────────────────────────────────────────

export async function register() {
  // Only run in the Node.js runtime (not Edge, not during build)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Skip during build and test
  const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  if (isTest) return;

  // ── Validate config ──────────────────────────────────────────────────────
  const { validateConfig, getConfigSummary, APP_CONFIG } = await import('./lib/config');
  const result = validateConfig();

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`⚠️  Config warning: ${w}`);
    }
  }

  if (!result.valid) {
    for (const e of result.errors) {
      console.error(`❌ Config error: ${e}`);
    }
    console.error('Server starting anyway — Gemini calls will fail until GEMINI_API_KEY is set.');
    // Don't process.exit — let the server start so the admin dashboard is accessible
    // The user can set the key via the admin UI or .env.local and restart
  } else {
    console.log('✅ Config validated successfully');
    console.log('📋 Config:', JSON.stringify(getConfigSummary(), null, 2));
  }

  // ── Start scheduler ──────────────────────────────────────────────────────
  if (APP_CONFIG.schedulerEnabled) {
    const { startScheduler } = await import('./scheduler/autoPublisher');
    startScheduler();
  } else {
    console.log('[Scheduler] Disabled via SCHEDULER_ENABLED=false');
  }
}
