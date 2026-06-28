import { autonomousPublisher } from '@/agents/autonomousPublisher';
import { APP_CONFIG } from '@/lib/config';
import { logger } from '@/lib/logger';

const INTERVAL_MS = APP_CONFIG.schedulerIntervalMs;

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
    logger.info('[Scheduler] Skipping cycle - previous cycle still running');
    return;
  }

  state.isProcessing = true;

  try {
    const result = await autonomousPublisher();
    state.lastRun = new Date().toISOString();

    if (result.success) {
      state.totalGenerated++;
      logger.info(`[Scheduler] Cycle complete. Total generated: ${state.totalGenerated}`);
    } else {
      logger.info(`[Scheduler] Cycle skipped: ${result.message}`);

      // Retry once on failure
      logger.info('[Scheduler] Retrying once...');
      const retry = await autonomousPublisher();
      if (retry.success) {
        state.totalGenerated++;
        logger.info(`[Scheduler] Retry succeeded. Total generated: ${state.totalGenerated}`);
      } else {
        logger.info(`[Scheduler] Retry also failed: ${retry.message}`);
      }
    }
  } catch (error) {
    logger.error('[Scheduler] Unexpected error', error instanceof Error ? error : undefined);
  } finally {
    state.isProcessing = false;
  }
}

export function startScheduler(): void {
  const state = getState();

  if (state.running && state.intervalId) {
    logger.info('[Scheduler] Already running');
    return;
  }

  logger.info(`[Scheduler] Starting auto-publisher (interval: ${Math.round(INTERVAL_MS / 60000)} minutes)`);
  state.running = true;

  // Run first cycle immediately
  runCycle();

  // Then set interval
  state.intervalId = setInterval(runCycle, INTERVAL_MS);
}

export function stopScheduler(): void {
  const state = getState();

  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.running = false;
  logger.info('[Scheduler] Stopped');
}

export function getSchedulerStatus() {
  const state = getState();
  return {
    running: state.running,
    lastRun: state.lastRun,
    totalGenerated: state.totalGenerated,
  };
}

export function toggleScheduler(): boolean {
  const state = getState();
  if (state.running) {
    stopScheduler();
  } else {
    startScheduler();
  }
  return getState().running;
}
