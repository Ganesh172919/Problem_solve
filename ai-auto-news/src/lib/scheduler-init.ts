import { startScheduler } from '@/scheduler/autoPublisher';
import { startTaskQueue } from '@/workers/taskQueue';

const initKey = '__schedulerInitialized__';

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
}

function isTestLike(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.JEST_WORKER_ID !== undefined ||
    process.env.VITEST !== undefined
  );
}

function isBuildLike(): boolean {
  const phase = process.env.NEXT_PHASE?.toLowerCase() ?? '';
  if (phase.includes('build')) return true;

  const lifecycle = process.env.npm_lifecycle_event?.toLowerCase();
  if (lifecycle === 'build') return true;

  const argv = process.argv.map((arg) => arg.toLowerCase()).join(' ');
  return argv.includes('next') && argv.includes('build');
}

export function initializeScheduler(): void {
  const g = globalThis as unknown as Record<string, boolean>;

  if (g[initKey]) {
    return;
  }

  const disallowBackgroundServices = isBuildLike() || isTestLike();
  if (disallowBackgroundServices) {
    return;
  }

  const defaultEnabled = true;
  const schedulerEnabled = parseBooleanEnv(process.env.SCHEDULER_ENABLED) ?? defaultEnabled;
  const taskQueueEnabled = parseBooleanEnv(process.env.TASK_QUEUE_ENABLED) ?? defaultEnabled;

  g[initKey] = true;
  if (schedulerEnabled) startScheduler();
  if (taskQueueEnabled) startTaskQueue();
}
