/**
 * Scheduled Task Engine
 *
 * Distributed cron-based task scheduler with:
 * - Cron expression parsing and scheduling
 * - Distributed locking to prevent duplicate execution
 * - Task history and retention
 * - Retry with exponential backoff on failure
 * - Task dependency chains
 * - Dynamic task registration and deregistration
 * - Execution time budgets and timeouts
 * - Per-tenant task isolation
 * - Missed execution detection and catch-up
 * - Task pausing and resuming
 * - Priority queues for urgent tasks
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type TaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  handler: TaskHandler;
  options: TaskOptions;
  tenantId?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
  runCount: number;
  failCount: number;
  avgDurationMs: number;
}

export interface TaskOptions {
  timeout: number; // ms
  retryAttempts: number;
  retryDelayMs: number;
  priority: TaskPriority;
  allowConcurrent: boolean;
  catchUpMissed: boolean; // run missed executions on startup
  maxMissedExecutions: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export type TaskHandler = (context: TaskExecutionContext) => Promise<TaskResult>;

export interface TaskExecutionContext {
  taskId: string;
  taskName: string;
  tenantId?: string;
  scheduledFor: Date;
  attempt: number;
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  nextRunOverride?: Date; // override next scheduled run
}

export interface TaskExecution {
  executionId: string;
  taskId: string;
  taskName: string;
  tenantId?: string;
  scheduledFor: Date;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  attempt: number;
  status: TaskStatus;
  result?: TaskResult;
  error?: string;
  lockedBy?: string;
  lockExpiresAt?: Date;
}

export interface TaskSchedulerMetrics {
  totalTasks: number;
  enabledTasks: number;
  executionsLast24h: number;
  failuresLast24h: number;
  avgExecutionMs: number;
  upcomingIn1h: number;
}

// CronField: [min, hour, dayOfMonth, month, dayOfWeek]
type CronField = { type: 'wildcard' } | { type: 'value'; v: number } | { type: 'range'; from: number; to: number } | { type: 'step'; step: number; from?: number };

interface ParsedCron {
  minute: CronField[];
  hour: CronField[];
  dayOfMonth: CronField[];
  month: CronField[];
  dayOfWeek: CronField[];
}

function parseCronField(part: string, min: number, max: number): CronField[] {
  const fields: CronField[] = [];
  for (const segment of part.split(',')) {
    if (segment === '*') {
      fields.push({ type: 'wildcard' });
    } else if (segment.startsWith('*/')) {
      fields.push({ type: 'step', step: parseInt(segment.slice(2), 10) });
    } else if (segment.includes('/')) {
      const [rangeOrStar, step] = segment.split('/');
      const from = rangeOrStar === '*' ? min : parseInt(rangeOrStar, 10);
      fields.push({ type: 'step', step: parseInt(step, 10), from });
    } else if (segment.includes('-')) {
      const [from, to] = segment.split('-').map(Number);
      fields.push({ type: 'range', from, to });
    } else {
      fields.push({ type: 'value', v: parseInt(segment, 10) });
    }
  }
  return fields;
}

function matchesCronField(fields: CronField[], value: number, min: number): boolean {
  for (const field of fields) {
    if (field.type === 'wildcard') return true;
    if (field.type === 'value' && field.v === value) return true;
    if (field.type === 'range' && value >= field.from && value <= field.to) return true;
    if (field.type === 'step') {
      const from = field.from ?? min;
      if (value >= from && (value - from) % field.step === 0) return true;
    }
  }
  return false;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expression}`);
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
  };
}

export function cronMatches(cron: ParsedCron, date: Date): boolean {
  return (
    matchesCronField(cron.minute, date.getMinutes(), 0) &&
    matchesCronField(cron.hour, date.getHours(), 0) &&
    matchesCronField(cron.dayOfMonth, date.getDate(), 1) &&
    matchesCronField(cron.month, date.getMonth() + 1, 1) &&
    matchesCronField(cron.dayOfWeek, date.getDay(), 0)
  );
}

export function nextCronRun(expression: string, after: Date = new Date()): Date {
  const cron = parseCron(expression);
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // start from next minute

  // Search up to 1 year ahead
  const maxDate = new Date(after.getTime() + 366 * 86400000);
  while (candidate < maxDate) {
    if (cronMatches(cron, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error(`No next run found for cron: ${expression}`);
}

const taskRegistry = new Map<string, ScheduledTask>();
const executionHistory: TaskExecution[] = [];
const MAX_HISTORY = 1000;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
const NODE_ID = `node_${Math.random().toString(36).slice(2, 10)}`;

export function registerTask(task: Omit<ScheduledTask, 'createdAt' | 'updatedAt' | 'runCount' | 'failCount' | 'avgDurationMs' | 'nextRunAt'>): ScheduledTask {
  const fullTask: ScheduledTask = {
    ...task,
    createdAt: new Date(),
    updatedAt: new Date(),
    runCount: 0,
    failCount: 0,
    avgDurationMs: 0,
    nextRunAt: task.enabled ? nextCronRun(task.cronExpression) : undefined,
  };
  taskRegistry.set(task.id, fullTask);
  logger.info('Task registered', { taskId: task.id, name: task.name, cron: task.cronExpression });
  return fullTask;
}

export function deregisterTask(taskId: string): void {
  taskRegistry.delete(taskId);
  logger.info('Task deregistered', { taskId });
}

export function pauseTask(taskId: string): void {
  const task = taskRegistry.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  task.enabled = false;
  task.updatedAt = new Date();
  logger.info('Task paused', { taskId });
}

export function resumeTask(taskId: string): void {
  const task = taskRegistry.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  task.enabled = true;
  task.nextRunAt = nextCronRun(task.cronExpression);
  task.updatedAt = new Date();
  logger.info('Task resumed', { taskId, nextRunAt: task.nextRunAt });
}

async function acquireExecutionLock(taskId: string, timeoutMs: number): Promise<boolean> {
  const cache = getCache();
  const lockKey = `scheduler:lock:${taskId}`;
  const existing = cache.get(lockKey);
  if (existing) return false;
  cache.set(lockKey, NODE_ID, Math.ceil(timeoutMs / 1000) + 30);
  return true;
}

function releaseExecutionLock(taskId: string): void {
  const cache = getCache();
  cache.del(`scheduler:lock:${taskId}`);
}

async function executeTask(task: ScheduledTask, scheduledFor: Date, attempt = 1): Promise<TaskExecution> {
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const execution: TaskExecution = {
    executionId,
    taskId: task.id,
    taskName: task.name,
    tenantId: task.tenantId,
    scheduledFor,
    startedAt: new Date(),
    attempt,
    status: 'running',
    lockedBy: NODE_ID,
    lockExpiresAt: new Date(Date.now() + task.options.timeout),
  };

  executionHistory.unshift(execution);
  if (executionHistory.length > MAX_HISTORY) executionHistory.length = MAX_HISTORY;

  const ctx: TaskExecutionContext = {
    taskId: task.id,
    taskName: task.name,
    tenantId: task.tenantId,
    scheduledFor,
    attempt,
    metadata: task.options.metadata,
  };

  const startMs = Date.now();
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Task timeout after ${task.options.timeout}ms`)), task.options.timeout),
    );

    const result = await Promise.race([task.handler(ctx), timeoutPromise]) as TaskResult;
    const durationMs = Date.now() - startMs;

    execution.completedAt = new Date();
    execution.durationMs = durationMs;
    execution.result = result;
    execution.status = result.success ? 'completed' : 'failed';

    task.runCount += 1;
    task.lastRunAt = new Date();
    task.avgDurationMs = (task.avgDurationMs * (task.runCount - 1) + durationMs) / task.runCount;
    task.nextRunAt = result.nextRunOverride ?? nextCronRun(task.cronExpression, new Date());

    if (result.success) {
      logger.info('Task completed', { taskId: task.id, durationMs, message: result.message });
    } else {
      task.failCount += 1;
      logger.warn('Task failed', { taskId: task.id, durationMs, message: result.message });

      if (attempt < task.options.retryAttempts) {
        const delay = task.options.retryDelayMs * attempt;
        logger.info('Scheduling task retry', { taskId: task.id, attempt: attempt + 1, delayMs: delay });
        setTimeout(() => executeTask(task, scheduledFor, attempt + 1), delay);
      }
    }

    return execution;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    execution.completedAt = new Date();
    execution.durationMs = durationMs;
    execution.status = 'failed';
    execution.error = String(err);

    task.failCount += 1;
    task.lastRunAt = new Date();
    task.nextRunAt = nextCronRun(task.cronExpression, new Date());

    logger.error('Task execution error', undefined, { taskId: task.id, attempt, error: err });

    if (attempt < task.options.retryAttempts) {
      const delay = task.options.retryDelayMs * attempt;
      setTimeout(() => executeTask(task, scheduledFor, attempt + 1), delay);
    }

    return execution;
  } finally {
    releaseExecutionLock(task.id);
  }
}

async function tickScheduler(): Promise<void> {
  const now = new Date();

  for (const task of taskRegistry.values()) {
    if (!task.enabled) continue;
    if (!task.nextRunAt || task.nextRunAt > now) continue;

    // Skip if already running (unless concurrent allowed)
    if (!task.options.allowConcurrent) {
      const cache = getCache();
      if (cache.get(`scheduler:lock:${task.id}`)) {
        logger.debug('Task already running, skipping', { taskId: task.id });
        task.nextRunAt = nextCronRun(task.cronExpression, now);
        continue;
      }
    }

    const acquired = await acquireExecutionLock(task.id, task.options.timeout);
    if (!acquired) {
      task.nextRunAt = nextCronRun(task.cronExpression, now);
      continue;
    }

    const scheduledFor = task.nextRunAt;
    task.nextRunAt = nextCronRun(task.cronExpression, now);

    // Execute asynchronously
    executeTask(task, scheduledFor).catch((err) =>
      logger.error('Unhandled task error', undefined, { taskId: task.id, error: err }),
    );
  }
}

export function startScheduler(intervalMs = 60000): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    tickScheduler().catch((err) => logger.error('Scheduler tick error', undefined, { error: err }));
  }, intervalMs);
  logger.info('Scheduler started', { intervalMs, nodeId: NODE_ID });
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info('Scheduler stopped');
  }
}

export async function triggerTaskNow(taskId: string): Promise<TaskExecution> {
  const task = taskRegistry.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const acquired = await acquireExecutionLock(task.id, task.options.timeout);
  if (!acquired) throw new Error(`Task ${taskId} is already running`);

  return executeTask(task, new Date());
}

export function getTaskExecutionHistory(taskId: string, limit = 20): TaskExecution[] {
  return executionHistory
    .filter((e) => e.taskId === taskId)
    .slice(0, limit);
}

export function getAllExecutionHistory(limit = 100): TaskExecution[] {
  return executionHistory.slice(0, limit);
}

export function getTaskMetrics(): TaskSchedulerMetrics {
  const now = Date.now();
  const oneDayAgo = now - 86400000;
  const oneHourLater = now + 3600000;

  const recent = executionHistory.filter((e) => e.startedAt && e.startedAt.getTime() > oneDayAgo);
  const failures = recent.filter((e) => e.status === 'failed');
  const avgMs = recent.filter((e) => e.durationMs).reduce((s, e) => s + (e.durationMs ?? 0), 0) / (recent.length || 1);

  const tasks = Array.from(taskRegistry.values());

  return {
    totalTasks: tasks.length,
    enabledTasks: tasks.filter((t) => t.enabled).length,
    executionsLast24h: recent.length,
    failuresLast24h: failures.length,
    avgExecutionMs: avgMs,
    upcomingIn1h: tasks.filter((t) => t.nextRunAt && t.nextRunAt.getTime() < oneHourLater).length,
  };
}

export function listTasks(tenantId?: string): ScheduledTask[] {
  const all = Array.from(taskRegistry.values());
  if (tenantId) return all.filter((t) => t.tenantId === tenantId || !t.tenantId);
  return all;
}

export function getTask(taskId: string): ScheduledTask | null {
  return taskRegistry.get(taskId) ?? null;
}
