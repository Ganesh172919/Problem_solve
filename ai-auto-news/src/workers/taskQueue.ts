import { claimNextTask, completeTask, failTask, requeueStuckTasks, getTaskStats } from '@/db/tasks';
import { orchestrate } from '@/agents/agentOrchestrator';
import { logger } from '@/lib/logger';
import { APP_CONFIG } from '@/lib/config';

const log = logger.child({ module: 'TaskQueue' });

type TaskHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, TaskHandler>();

handlers.set('publish_content', async (payload) => {
  const category = payload.category as 'blog' | 'news' | undefined;
  const topic = payload.topic as string | undefined;
  const result = await orchestrate({ type: 'publish_content', category, topic });
  if (!result.success) {
    throw new Error(result.error || 'Orchestration failed');
  }
});

handlers.set('bulk_publish', async (payload) => {
  const count = (payload.count as number) || 1;
  const category = payload.category as 'blog' | 'news' | undefined;
  const result = await orchestrate({ type: 'bulk_publish', count, category });
  if (!result.success) {
    throw new Error(result.error || 'Bulk publish failed');
  }
});

handlers.set('research_only', async (payload) => {
  const topic = payload.topic as string | undefined;
  const result = await orchestrate({ type: 'research_only', topic });
  if (!result.success) {
    throw new Error(result.error || 'Research failed');
  }
});

async function processCycle(): Promise<void> {
  const requeued = requeueStuckTasks(10);
  if (requeued > 0) {
    log.warn('Requeued stuck tasks', { count: requeued });
  }

  const task = claimNextTask();
  if (!task) return;

  const handler = handlers.get(task.type);
  if (!handler) {
    log.warn('No handler for task type', { taskId: task.id, type: task.type });
    failTask(task.id, `No handler registered for type: ${task.type}`);
    return;
  }

  log.info('Processing task', { taskId: task.id, type: task.type, attempt: task.attempts });

  try {
    await handler(task.payload);
    completeTask(task.id);
    log.info('Task completed', { taskId: task.id, type: task.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Task failed', error instanceof Error ? error : undefined, {
      taskId: task.id,
      type: task.type,
    });
    failTask(task.id, message);
  }
}

interface TaskQueueState {
  running: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  processedCount: number;
  failedCount: number;
}

const GLOBAL_QUEUE_KEY = '__taskQueueState__';

function getQueueState(): TaskQueueState {
  const g = globalThis as unknown as Record<string, TaskQueueState>;
  if (!g[GLOBAL_QUEUE_KEY]) {
    g[GLOBAL_QUEUE_KEY] = {
      running: false,
      intervalId: null,
      processedCount: 0,
      failedCount: 0,
    };
  }
  return g[GLOBAL_QUEUE_KEY];
}

export function startTaskQueue(): void {
  const state = getQueueState();
  if (state.running) return;

  state.running = true;
  log.info('Task queue started', { intervalMs: APP_CONFIG.taskQueueIntervalMs });

  state.intervalId = setInterval(async () => {
    try {
      await processCycle();
    } catch (error) {
      log.error('Task queue cycle error', error instanceof Error ? error : undefined);
    }
  }, APP_CONFIG.taskQueueIntervalMs);
}

export function stopTaskQueue(): void {
  const state = getQueueState();
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.running = false;
  log.info('Task queue stopped');
}

export function getTaskQueueStatus(): {
  running: boolean;
  processedCount: number;
  failedCount: number;
  taskStats: ReturnType<typeof getTaskStats>;
} {
  const state = getQueueState();
  return {
    running: state.running,
    processedCount: state.processedCount,
    failedCount: state.failedCount,
    taskStats: getTaskStats(),
  };
}
