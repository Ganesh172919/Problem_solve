import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead';

export interface TaskDefinition {
  id: string;
  name: string;
  handler: (payload: unknown, context: TaskContext) => Promise<unknown>;
  maxRetries?: number;
  timeoutMs?: number;
  priority?: number; // higher = more urgent
  tags?: string[];
}

export interface Task {
  id: string;
  definitionId: string;
  payload: unknown;
  status: TaskStatus;
  priority: number;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  workerId?: string;
  dependsOn: string[];  // task IDs this task waits for
  result?: unknown;
  error?: string;
  tags: string[];
}

export interface TaskContext {
  taskId: string;
  attemptNumber: number;
  workerId: string;
  logger: ReturnType<typeof getLogger>;
}

export interface CronJob {
  id: string;
  name: string;
  cronExpression: string;
  definitionId: string;
  payload?: unknown;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt: Date;
  runCount: number;
  failCount: number;
  createdAt: Date;
}

export interface TaskDependency {
  taskId: string;
  dependsOnId: string;
}

export interface WorkerState {
  id: string;
  status: 'idle' | 'busy' | 'offline';
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  lastHeartbeat: Date;
  load: number; // 0–1
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
  workerId: string;
  completedAt: Date;
}

export interface DeadLetterEntry {
  id: string;
  task: Task;
  reason: string;
  attempts: number;
  deadAt: Date;
  canRetry: boolean;
}

interface SchedulerMonitoringData {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  deadLetterCount: number;
  workerCount: number;
  activeWorkers: number;
  queueDepth: number;
  avgTaskDurationMs: number;
  throughputPerMinute: number;
}

// ─── Min-Heap (priority queue) ────────────────────────────────────────────────

class MinHeap<T> {
  private data: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) { this.data[0] = last; this.sinkDown(0); }
    return top;
  }

  peek(): T | undefined { return this.data[0]; }
  get size(): number    { return this.data.length; }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.data[i], this.data[parent]) < 0) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.compare(this.data[l], this.data[smallest]) < 0) smallest = l;
      if (r < n && this.compare(this.data[r], this.data[smallest]) < 0) smallest = r;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }

  toArray(): T[] { return [...this.data]; }
}

// ─── Cron parser ──────────────────────────────────────────────────────────────

function parseCronField(field: string, min: number, max: number): number[] {
  const result: number[] = [];
  if (field === '*') {
    for (let i = min; i <= max; i++) result.push(i);
    return result;
  }
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const stepN = parseInt(step, 10);
      const [rStart, rEnd] = range === '*'
        ? [min, max]
        : range.split('-').map(Number);
      for (let i = rStart; i <= (rEnd ?? max); i += stepN) result.push(i);
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) result.push(n);
    }
  }
  return [...new Set(result)].filter(n => n >= min && n <= max).sort((a, b) => a - b);
}

function nextCronDate(expression: string, after = new Date()): Date {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expression}`);
  const [minuteF, hourF, domF, monthF, dowF] = parts;
  const minutes  = parseCronField(minuteF, 0, 59);
  const hours    = parseCronField(hourF,   0, 23);
  const doms     = parseCronField(domF,    1, 31);
  const months   = parseCronField(monthF,  1, 12);
  const dows     = parseCronField(dowF,    0,  6);

  const date = new Date(after.getTime() + 60000); // advance at least 1 minute
  date.setSeconds(0, 0);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const dw = date.getDay();
    const h  = date.getHours();
    const mi = date.getMinutes();

    if (!months.includes(m))  { date.setMonth(date.getMonth() + 1, 1); date.setHours(0, 0, 0, 0); continue; }
    // Standard cron: DOM and DOW fields use OR semantics when both are non-wildcard;
    // here we use OR (advance if neither matches)
    const domWild = domF === '*'; const dowWild = dowF === '*';
    const domMatch = doms.includes(d); const dowMatch = dows.includes(dw);
    const dayMatch = domWild ? dowMatch : dowWild ? domMatch : domMatch || dowMatch;
    if (!dayMatch) { date.setDate(date.getDate() + 1); date.setHours(0, 0, 0, 0); continue; }
    if (!hours.includes(h))   { date.setHours(date.getHours() + 1, 0, 0, 0); continue; }
    if (!minutes.includes(mi)){ date.setMinutes(date.getMinutes() + 1, 0, 0); continue; }
    return new Date(date);
  }
  throw new Error(`Could not determine next run for cron: ${expression}`);
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

class DistributedTaskScheduler {
  private definitions  = new Map<string, TaskDefinition>();
  private tasks        = new Map<string, Task>();
  private cronJobs     = new Map<string, CronJob>();
  private workers      = new Map<string, WorkerState>();
  private deadLetter   = new Map<string, DeadLetterEntry>();
  private results      = new Map<string, TaskResult>();
  private taskQueue    = new MinHeap<Task>((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority; // higher priority first
    return a.scheduledAt.getTime() - b.scheduledAt.getTime();      // earlier first
  });
  private roundRobinIdx = 0;
  private tickInterval?: ReturnType<typeof setInterval>;

  constructor() {
    // Register a few default workers
    for (let i = 0; i < 4; i++) this.registerWorker(`worker_${i}`);
    // Start tick
    if (typeof setInterval !== 'undefined') {
      this.tickInterval = setInterval(() => this.tick(), 1000);
    }
  }

  // ── Worker management ──────────────────────────────────────────────────────

  registerWorker(id: string): WorkerState {
    const worker: WorkerState = {
      id, status: 'idle', tasksCompleted: 0, tasksFailed: 0,
      lastHeartbeat: new Date(), load: 0,
    };
    this.workers.set(id, worker);
    return worker;
  }

  heartbeat(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) worker.lastHeartbeat = new Date();
  }

  // ── Definition registry ────────────────────────────────────────────────────

  registerDefinition(def: TaskDefinition): void {
    this.definitions.set(def.id, def);
    logger.info('Task definition registered', { id: def.id, name: def.name });
  }

  // ── Task scheduling ────────────────────────────────────────────────────────

  scheduleTask(
    definitionId: string,
    payload: unknown,
    options?: {
      priority?: number;
      scheduledAt?: Date;
      dependsOn?: string[];
      tags?: string[];
    },
  ): Task {
    const def = this.definitions.get(definitionId);
    if (!def) throw new Error(`Task definition not found: ${definitionId}`);

    const task: Task = {
      id:           `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      definitionId,
      payload,
      status:       'pending',
      priority:     options?.priority ?? def.priority ?? 5,
      scheduledAt:  options?.scheduledAt ?? new Date(),
      retryCount:   0,
      maxRetries:   def.maxRetries ?? 3,
      timeoutMs:    def.timeoutMs  ?? 30000,
      dependsOn:    options?.dependsOn ?? [],
      tags:         options?.tags ?? def.tags ?? [],
    };
    this.tasks.set(task.id, task);
    this.enqueueIfReady(task);
    logger.info('Task scheduled', { taskId: task.id, definitionId, priority: task.priority });
    return task;
  }

  private enqueueIfReady(task: Task): void {
    if (task.status !== 'pending') return;
    const allDone = task.dependsOn.every(depId => {
      const dep = this.tasks.get(depId);
      return dep?.status === 'completed';
    });
    if (!allDone) return;
    task.status = 'queued';
    this.taskQueue.push(task);
  }

  // ── Cron scheduling ────────────────────────────────────────────────────────

  scheduleCron(
    definitionId: string,
    cronExpression: string,
    name: string,
    payload?: unknown,
  ): CronJob {
    const def = this.definitions.get(definitionId);
    if (!def) throw new Error(`Task definition not found: ${definitionId}`);

    const job: CronJob = {
      id: `cron_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      cronExpression,
      definitionId,
      payload,
      enabled: true,
      nextRunAt: nextCronDate(cronExpression),
      runCount: 0,
      failCount: 0,
      createdAt: new Date(),
    };
    this.cronJobs.set(job.id, job);
    logger.info('Cron job scheduled', { id: job.id, name, expression: cronExpression, nextRunAt: job.nextRunAt });
    return job;
  }

  // ── Cancellation ──────────────────────────────────────────────────────────

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return false;
    task.status = 'cancelled';
    logger.info('Task cancelled', { taskId });
    return true;
  }

  cancelCronJob(cronId: string): boolean {
    const job = this.cronJobs.get(cronId);
    if (!job) return false;
    job.enabled = false;
    return true;
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async executeTask(task: Task, workerId: string): Promise<TaskResult> {
    const def = this.definitions.get(task.definitionId);
    if (!def) throw new Error(`Definition missing: ${task.definitionId}`);

    const worker = this.workers.get(workerId);
    if (worker) { worker.status = 'busy'; worker.currentTaskId = task.id; worker.load = 1; }

    task.status    = 'running';
    task.startedAt = new Date();
    task.workerId  = workerId;
    const start    = Date.now();

    const ctx: TaskContext = {
      taskId: task.id,
      attemptNumber: task.retryCount + 1,
      workerId,
      logger: getLogger(),
    };

    let result: TaskResult;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${task.timeoutMs}ms`)), task.timeoutMs)
      );
      const output = await Promise.race([def.handler(task.payload, ctx), timeout]);
      task.status      = 'completed';
      task.completedAt = new Date();
      task.result      = output;

      result = {
        taskId: task.id,
        success: true,
        result: output,
        durationMs: Date.now() - start,
        workerId,
        completedAt: task.completedAt,
      };
      if (worker) { worker.tasksCompleted++; }

      // Unblock dependent tasks
      for (const [, t] of this.tasks) {
        if (t.dependsOn.includes(task.id) && t.status === 'pending') {
          this.enqueueIfReady(t);
        }
      }
      logger.info('Task completed', { taskId: task.id, durationMs: result.durationMs });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      task.error = errMsg;

      if (task.retryCount < task.maxRetries) {
        const delay = this.retryWithBackoff(task);
        logger.warn('Task failed, scheduling retry', { taskId: task.id, attempt: task.retryCount, delay });
      } else {
        task.status      = 'failed';
        task.completedAt = new Date();
        this.sendToDeadLetter(task, errMsg);
        if (worker) worker.tasksFailed++;
      }

      result = {
        taskId: task.id,
        success: false,
        error: errMsg,
        durationMs: Date.now() - start,
        workerId,
        completedAt: new Date(),
      };
    } finally {
      if (worker) { worker.status = 'idle'; worker.currentTaskId = undefined; worker.load = 0; }
    }

    this.results.set(task.id, result);
    return result;
  }

  // ── Retry with exponential backoff ────────────────────────────────────────

  retryWithBackoff(task: Task): number {
    task.retryCount++;
    task.status = 'pending';
    task.startedAt  = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    const baseDelay  = 1000;
    const jitter     = Math.random() * 500;
    const delayMs    = Math.min(baseDelay * Math.pow(2, task.retryCount - 1) + jitter, 60000);
    task.scheduledAt = new Date(Date.now() + delayMs);
    return delayMs;
  }

  // ── Dead letter queue ─────────────────────────────────────────────────────

  private sendToDeadLetter(task: Task, reason: string): void {
    const entry: DeadLetterEntry = {
      id:       `dlq_${task.id}`,
      task:     { ...task },
      reason,
      attempts: task.retryCount + 1,
      deadAt:   new Date(),
      canRetry: true,
    };
    this.deadLetter.set(entry.id, entry);
    logger.warn('Task sent to dead letter queue', { taskId: task.id, reason, attempts: entry.attempts });
  }

  processDeadLetter(entryId: string): Task | null {
    const entry = this.deadLetter.get(entryId);
    if (!entry || !entry.canRetry) return null;
    const task = entry.task;
    task.status      = 'pending';
    task.retryCount  = 0;
    task.scheduledAt = new Date();
    task.error       = undefined;
    this.tasks.set(task.id, task);
    this.enqueueIfReady(task);
    entry.canRetry = false;
    logger.info('Dead letter entry requeued', { entryId, taskId: task.id });
    return task;
  }

  getDeadLetterQueue(): DeadLetterEntry[] {
    return Array.from(this.deadLetter.values());
  }

  // ── Load balancing ────────────────────────────────────────────────────────

  private selectWorker(): WorkerState | null {
    const idle = Array.from(this.workers.values()).filter(w => w.status === 'idle');
    if (idle.length === 0) return null;
    // Least-loaded first, tie-break by round-robin
    idle.sort((a, b) => a.load - b.load || a.tasksCompleted - b.tasksCompleted);
    const worker = idle[this.roundRobinIdx % idle.length];
    this.roundRobinIdx = (this.roundRobinIdx + 1) % Math.max(1, idle.length);
    return worker;
  }

  rebalanceWorkers(): void {
    const runningTasks = Array.from(this.tasks.values()).filter(t => t.status === 'running');
    const workerLoad   = new Map<string, number>();
    for (const t of runningTasks) {
      if (t.workerId) workerLoad.set(t.workerId, (workerLoad.get(t.workerId) ?? 0) + 1);
    }
    for (const [id, worker] of this.workers) {
      const load = workerLoad.get(id) ?? 0;
      worker.load = load / Math.max(1, runningTasks.length);
    }
    logger.info('Workers rebalanced', { workerCount: this.workers.size, queueDepth: this.taskQueue.size });
  }

  // ── Scheduler tick ────────────────────────────────────────────────────────

  private tick(): void {
    const now = new Date();

    // Fire due cron jobs
    for (const job of this.cronJobs.values()) {
      if (!job.enabled || job.nextRunAt > now) continue;
      job.lastRunAt = now;
      job.nextRunAt = nextCronDate(job.cronExpression, now);
      job.runCount++;
      const task = this.scheduleTask(job.definitionId, job.payload ?? {}, { priority: 5, tags: ['cron', job.id] });
      logger.info('Cron job fired', { cronId: job.id, taskId: task.id, nextRunAt: job.nextRunAt });
    }

    // Enqueue pending tasks whose scheduled time has arrived
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && task.scheduledAt <= now) {
        this.enqueueIfReady(task);
      }
    }

    // Dispatch queued tasks to idle workers
    while (this.taskQueue.size > 0) {
      const worker = this.selectWorker();
      if (!worker) break;
      const task = this.taskQueue.pop();
      if (!task || task.status === 'cancelled') continue;
      // Fire and forget (in a real system this would be message-queue based)
      this.executeTask(task, worker.id).catch(err =>
        logger.error('Unhandled task execution error', undefined, { taskId: task.id, error: String(err) })
      );
    }
  }

  // ── Monitoring ────────────────────────────────────────────────────────────

  getMonitoringData(): SchedulerMonitoringData {
    const cacheKey = 'scheduler_monitoring';
    const cached = cache.get<SchedulerMonitoringData>(cacheKey);
    if (cached) return cached;

    const allTasks = Array.from(this.tasks.values());
    const completedResults = Array.from(this.results.values()).filter(r => r.success);
    const avgDuration = completedResults.length > 0
      ? completedResults.reduce((a, r) => a + r.durationMs, 0) / completedResults.length
      : 0;

    const oneMinuteAgo = Date.now() - 60000;
    const throughput = completedResults.filter(r => r.completedAt.getTime() > oneMinuteAgo).length;

    const data: SchedulerMonitoringData = {
      totalTasks:      allTasks.length,
      pendingTasks:    allTasks.filter(t => t.status === 'pending').length,
      runningTasks:    allTasks.filter(t => t.status === 'running').length,
      completedTasks:  allTasks.filter(t => t.status === 'completed').length,
      failedTasks:     allTasks.filter(t => t.status === 'failed').length,
      deadLetterCount: this.deadLetter.size,
      workerCount:     this.workers.size,
      activeWorkers:   Array.from(this.workers.values()).filter(w => w.status === 'busy').length,
      queueDepth:      this.taskQueue.size,
      avgTaskDurationMs: Math.round(avgDuration),
      throughputPerMinute: throughput,
    };

    cache.set(cacheKey, data, 10);
    return data;
  }

  getTask(id: string): Task | undefined        { return this.tasks.get(id); }
  getCronJob(id: string): CronJob | undefined   { return this.cronJobs.get(id); }
  listWorkers(): WorkerState[]                   { return Array.from(this.workers.values()); }
  listCronJobs(): CronJob[]                      { return Array.from(this.cronJobs.values()); }
  getTaskResult(id: string): TaskResult | undefined { return this.results.get(id); }

  destroy(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getDistributedTaskScheduler(): DistributedTaskScheduler {
  if (!(globalThis as any).__distributedTaskScheduler__) {
    (globalThis as any).__distributedTaskScheduler__ = new DistributedTaskScheduler();
  }
  return (globalThis as any).__distributedTaskScheduler__;
}
