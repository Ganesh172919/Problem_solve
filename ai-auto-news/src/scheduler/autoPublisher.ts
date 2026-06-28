// ─────────────────────────────────────────────────────────────────────────────
// Background scheduler that triggers content generation cycles at regular intervals.
// Runs inside the Next.js server process using setInterval.
//
// WHY setInterval (not cron or a separate worker process):
//  - Keeps the setup to zero external dependencies (just Node.js)
//  - Shares the same SQLite connection pool as the main app
//  - Next.js instrumentation hooks ensure it starts on server boot
// ─────────────────────────────────────────────────────────────────────────────

import { runGenerationCycle } from '@/agents/orchestratorAgent';
import getDb from '@/db/index';

const INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS || '3600000', 10);

interface SchedulerState {
  intervalId: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastRun: string | null;
  totalGenerated: number;
  isProcessing: boolean;
}

// Global singleton state — survives hot reloads via globalThis
const globalKey = '__autoPublisherState__';

function getState(): SchedulerState {
  const g = globalThis as unknown as Record<string, SchedulerState>;
  if (!g[globalKey]) {
    g[globalKey] = {
      intervalId: null,
      running: false,
      lastRun: null,
      totalGenerated: 0,
      isProcessing: false,
    };
  }
  return g[globalKey];
}

async function runCycle(): Promise<void> {
  const state = getState();

  // Lock mechanism: skip if already processing
  if (state.isProcessing) {
    console.log('[Scheduler] Skipping cycle — previous cycle still running');
    return;
  }

  state.isProcessing = true;

  try {
    // Fetch user preferences for personalized generation
    let prefs: Record<string, string> | undefined;
    try {
      const db = getDb();
      const row = db.prepare(
        `SELECT topics, tone, frequency FROM user_preferences ORDER BY created_at DESC LIMIT 1`
      ).get() as Record<string, string> | undefined;
      if (row) prefs = row;
    } catch {
      // No preferences table yet or empty — use defaults
    }

    const result = await runGenerationCycle(prefs);
    state.lastRun = new Date().toISOString();

    if (result.success) {
      state.totalGenerated += result.articlesPublished;
      console.log(`[Scheduler] Cycle complete. Total generated: ${state.totalGenerated}`);
    } else {
      console.log(`[Scheduler] Cycle failed: ${result.message}`);
    }
  } catch (error) {
    console.error('[Scheduler] Unexpected error:', error instanceof Error ? error.message : error);
  } finally {
    state.isProcessing = false;
  }
}

/**
 * startScheduler — begins the auto-publishing loop.
 * Safe to call multiple times — subsequent calls are no-ops if already running.
 */
export function startScheduler(): void {
  const state = getState();

  if (state.running && state.intervalId) {
    console.log('[Scheduler] Already running');
    return;
  }

  console.log(`[Scheduler] Starting auto-publisher (interval: ${Math.round(INTERVAL_MS / 60000)} minutes)`);
  state.running = true;

  // Update DB state
  try {
    const db = getDb();
    db.prepare(`UPDATE scheduler_state SET is_running = 1, interval_ms = ? WHERE id = 1`).run(INTERVAL_MS);
  } catch {
    // Non-fatal
  }

  // Run first cycle after a short delay (let the app finish booting)
  setTimeout(() => runCycle(), 5_000);

  // Then set interval
  state.intervalId = setInterval(runCycle, INTERVAL_MS);
}

/**
 * stopScheduler — stops the auto-publishing loop gracefully.
 * In-progress generation cycles are allowed to complete.
 */
export function stopScheduler(): void {
  const state = getState();

  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.running = false;

  try {
    const db = getDb();
    db.prepare(`UPDATE scheduler_state SET is_running = 0 WHERE id = 1`).run();
  } catch {
    // Non-fatal
  }

  console.log('[Scheduler] Stopped');
}

/**
 * getSchedulerStatus — returns current scheduler state for the admin dashboard.
 */
export function getSchedulerStatus() {
  const state = getState();
  return {
    running: state.running,
    lastRun: state.lastRun,
    totalGenerated: state.totalGenerated,
  };
}

/**
 * toggleScheduler — toggles the scheduler on/off. Returns new running state.
 */
export function toggleScheduler(): boolean {
  const state = getState();
  if (state.running) {
    stopScheduler();
  } else {
    startScheduler();
  }
  return getState().running;
}
