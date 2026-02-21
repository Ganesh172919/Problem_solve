import { startScheduler } from '@/scheduler/autoPublisher';

const initKey = '__schedulerInitialized__';

export function initializeScheduler(): void {
  const g = globalThis as unknown as Record<string, boolean>;

  if (g[initKey]) {
    return;
  }

  g[initKey] = true;
  startScheduler();
}
