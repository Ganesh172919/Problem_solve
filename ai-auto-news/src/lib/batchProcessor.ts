import { getLogger } from '../lib/logger';

const logger = getLogger();
export type Priority = 'critical' | 'high' | 'normal' | 'low';

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  strategy: 'fixed' | 'exponential' | 'linear';
  maxDelayMs?: number;
}
export interface RateLimitConfig { maxPerSecond: number; burstSize?: number }
export interface BatchWindowConfig { maxSize: number; maxWaitMs: number }

export interface BatchJobOptions<T = unknown> {
  id?: string;
  data: T;
  priority?: Priority;
  retryPolicy?: RetryPolicy;
  metadata?: Record<string, unknown>;
}
export interface BatchJobResult<R = unknown> {
  jobId: string;
  success: boolean;
  result?: R;
  error?: Error;
  attempts: number;
  durationMs: number;
}
export interface DeadLetterEntry<T = unknown> {
  jobId: string;
  data: T;
  error: Error;
  attempts: number;
  failedAt: string;
  metadata?: Record<string, unknown>;
}
export interface BatchStats {
  totalSubmitted: number;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  totalRetries: number;
  deadLetterCount: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  throughputPerSec: number;
  activeJobs: number;
  queueDepth: number;
  startedAt: string;
  uptimeMs: number;
}
export interface Checkpoint {
  processorId: string;
  timestamp: string;
  completedJobIds: string[];
  pendingJobIds: string[];
  stats: BatchStats;
}
export interface PipelineStage<TIn = unknown, TOut = unknown> {
  name: string;
  handler: (item: TIn) => Promise<TOut>;
  concurrency?: number;
  retryPolicy?: RetryPolicy;
}
export interface ScheduleEntry {
  id: string;
  cron: string;
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}
export type ProcessorState = 'idle' | 'running' | 'draining' | 'stopped';

interface InternalJob<T> {
  id: string;
  data: T;
  priority: Priority;
  retryPolicy: RetryPolicy;
  attempts: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(config: RateLimitConfig) {
    this.capacity = config.burstSize ?? config.maxPerSecond;
    this.refillRate = config.maxPerSecond;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate * 1000);
    await sleep(waitMs);
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

class PriorityQueue<T> {
  private buckets: Map<Priority, InternalJob<T>[]> = new Map([
    ['critical', []], ['high', []], ['normal', []], ['low', []],
  ]);
  private _size = 0;

  enqueue(job: InternalJob<T>): void {
    this.buckets.get(job.priority)!.push(job);
    this._size++;
  }

  dequeue(): InternalJob<T> | undefined {
    for (const p of ['critical', 'high', 'normal', 'low'] as Priority[]) {
      const bucket = this.buckets.get(p)!;
      if (bucket.length > 0) {
        this._size--;
        return bucket.shift();
      }
    }
    return undefined;
  }

  peek(): InternalJob<T> | undefined {
    for (const p of ['critical', 'high', 'normal', 'low'] as Priority[]) {
      const bucket = this.buckets.get(p)!;
      if (bucket.length > 0) return bucket[0];
    }
    return undefined;
  }

  get size(): number { return this._size; }

  drain(): InternalJob<T>[] {
    const all: InternalJob<T>[] = [];
    for (const p of ['critical', 'high', 'normal', 'low'] as Priority[]) {
      const bucket = this.buckets.get(p)!;
      all.push(...bucket);
      bucket.length = 0;
    }
    this._size = 0;
    return all;
  }

  ids(): string[] {
    const result: string[] = [];
    const priorities: Priority[] = ['critical', 'high', 'normal', 'low'];
    for (const p of priorities) {
      const bucket = this.buckets.get(p)!;
      for (const job of bucket) result.push(job.id);
    }
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let idCounter = 0;
function generateId(): string {
  return `batch_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function computeRetryDelay(policy: RetryPolicy, attempt: number): number {
  let delay: number;
  switch (policy.strategy) {
    case 'exponential':
      delay = policy.baseDelayMs * Math.pow(2, attempt);
      break;
    case 'linear':
      delay = policy.baseDelayMs * (attempt + 1);
      break;
    default:
      delay = policy.baseDelayMs;
  }
  return Math.min(delay, policy.maxDelayMs ?? 30_000);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
export interface BatchProcessorConfig<T, R> {
  handler: (item: T) => Promise<R>;
  concurrency?: number;
  retryPolicy?: RetryPolicy;
  rateLimit?: RateLimitConfig;
  batchWindow?: BatchWindowConfig;
  backpressureThreshold?: number;
  onResult?: (result: BatchJobResult<R>) => void;
  onDeadLetter?: (entry: DeadLetterEntry<T>) => void;
}

export class BatchProcessor<T = unknown, R = unknown> {
  private readonly config: Required<Pick<BatchProcessorConfig<T, R>, 'concurrency' | 'retryPolicy' | 'backpressureThreshold'>>;
  private readonly handler: (item: T) => Promise<R>;
  private readonly rateLimiter: TokenBucket | null;
  private readonly batchWindow: BatchWindowConfig | null;
  private readonly onResult?: (result: BatchJobResult<R>) => void;
  private readonly onDeadLetter?: (entry: DeadLetterEntry<T>) => void;

  private queue = new PriorityQueue<T>();
  private deadLetterQueue: DeadLetterEntry<T>[] = [];
  private activeCount = 0;
  private state: ProcessorState = 'idle';
  private completedIds = new Set<string>();
  private latencies: number[] = [];
  private totalRetries = 0;
  private totalSucceeded = 0;
  private totalFailed = 0;
  private totalSubmitted = 0;
  private startedAt = 0;
  private processorId: string;

  private windowBuffer: InternalJob<T>[] = [];
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private drainResolve: (() => void) | null = null;
  private backpressureWaiters: Array<() => void> = [];
  private scheduleEntries: Map<string, ScheduleEntry & { timer: ReturnType<typeof setInterval> | null }> = new Map();

  constructor(config: BatchProcessorConfig<T, R>) {
    this.handler = config.handler;
    this.config = {
      concurrency: config.concurrency ?? 10,
      retryPolicy: config.retryPolicy ?? { maxRetries: 3, baseDelayMs: 500, strategy: 'exponential' },
      backpressureThreshold: config.backpressureThreshold ?? 1000,
    };
    this.rateLimiter = config.rateLimit ? new TokenBucket(config.rateLimit) : null;
    this.batchWindow = config.batchWindow ?? null;
    this.onResult = config.onResult;
    this.onDeadLetter = config.onDeadLetter;
    this.processorId = generateId();
  }

  async submit(options: BatchJobOptions<T>): Promise<string> {
    if (this.state === 'stopped') throw new Error('Processor is stopped');
    if (this.state === 'draining') throw new Error('Processor is draining, no new jobs accepted');
    await this.waitForBackpressure();
    const job: InternalJob<T> = {
      id: options.id ?? generateId(),
      data: options.data,
      priority: options.priority ?? 'normal',
      retryPolicy: options.retryPolicy ?? this.config.retryPolicy,
      attempts: 0,
      createdAt: Date.now(),
      metadata: options.metadata,
    };
    this.totalSubmitted++;
    if (this.batchWindow) {
      this.addToWindow(job);
    } else {
      this.queue.enqueue(job);
      this.tryProcess();
    }
    return job.id;
  }

  async submitBatch(items: BatchJobOptions<T>[]): Promise<string[]> {
    const ids: string[] = [];
    for (const item of items) {
      ids.push(await this.submit(item));
    }
    return ids;
  }

  start(): void {
    if (this.state === 'running') return;
    this.state = 'running';
    this.startedAt = Date.now();
    logger.info('Batch processor started', { processorId: this.processorId, concurrency: this.config.concurrency });
    this.tryProcess();
  }

  async drain(): Promise<void> {
    if (this.state === 'stopped') return;
    this.state = 'draining';
    logger.info('Draining batch processor', { pending: this.queue.size, active: this.activeCount });
    this.flushWindow();
    if (this.queue.size === 0 && this.activeCount === 0) return;
    return new Promise<void>(resolve => {
      this.drainResolve = resolve;
      this.tryProcess();
    });
  }

  stop(): void {
    this.state = 'stopped';
    if (this.windowTimer) { clearTimeout(this.windowTimer); this.windowTimer = null; }
    Array.from(this.scheduleEntries.values()).forEach(entry => {
      if (entry.timer) clearInterval(entry.timer);
    });
    this.scheduleEntries.clear();
    logger.info('Batch processor stopped', { processorId: this.processorId });
  }

  getStats(): BatchStats {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const totalProcessed = this.totalSucceeded + this.totalFailed;
    const uptimeMs = this.startedAt > 0 ? Date.now() - this.startedAt : 0;
    const uptimeSec = uptimeMs / 1000 || 1;
    return {
      totalSubmitted: this.totalSubmitted,
      totalProcessed,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
      totalRetries: this.totalRetries,
      deadLetterCount: this.deadLetterQueue.length,
      avgLatencyMs: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
      p99LatencyMs: percentile(sorted, 99),
      throughputPerSec: totalProcessed / uptimeSec,
      activeJobs: this.activeCount,
      queueDepth: this.queue.size,
      startedAt: this.startedAt > 0 ? new Date(this.startedAt).toISOString() : '',
      uptimeMs,
    };
  }

  getDeadLetterQueue(): DeadLetterEntry<T>[] {
    return [...this.deadLetterQueue];
  }

  replayDeadLetterQueue(): number {
    const items = this.deadLetterQueue.splice(0);
    for (const entry of items) {
      this.queue.enqueue({
        id: entry.jobId,
        data: entry.data,
        priority: 'low',
        retryPolicy: this.config.retryPolicy,
        attempts: 0,
        createdAt: Date.now(),
        metadata: entry.metadata,
      });
    }
    logger.info('Replayed dead letter queue', { count: items.length });
    this.tryProcess();
    return items.length;
  }

  checkpoint(): Checkpoint {
    return {
      processorId: this.processorId,
      timestamp: new Date().toISOString(),
      completedJobIds: Array.from(this.completedIds),
      pendingJobIds: this.queue.ids(),
      stats: this.getStats(),
    };
  }

  restore(checkpoint: Checkpoint, allJobs: Map<string, BatchJobOptions<T>>): number {
    let restored = 0;
    const completed = new Set(checkpoint.completedJobIds);
    for (const id of checkpoint.pendingJobIds) {
      const jobOpts = allJobs.get(id);
      if (jobOpts && !completed.has(id)) {
        this.queue.enqueue({
          id,
          data: jobOpts.data,
          priority: jobOpts.priority ?? 'normal',
          retryPolicy: jobOpts.retryPolicy ?? this.config.retryPolicy,
          attempts: 0,
          createdAt: Date.now(),
          metadata: jobOpts.metadata,
        });
        restored++;
      }
    }
    this.completedIds = new Set(checkpoint.completedJobIds);
    logger.info('Restored from checkpoint', { restored, completedCount: this.completedIds.size });
    this.tryProcess();
    return restored;
  }

  getState(): ProcessorState {
    return this.state;
  }

  schedule(id: string, cron: string, handler: () => Promise<void>): void {
    const intervalMs = parseCronToMs(cron);
    if (intervalMs <= 0) throw new Error(`Invalid cron expression: ${cron}`);
    const entry: ScheduleEntry & { timer: ReturnType<typeof setInterval> | null } = {
      id, cron, handler, enabled: true, timer: null,
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
    };
    entry.timer = setInterval(async () => {
      if (!entry.enabled || this.state === 'stopped') return;
      entry.lastRun = new Date().toISOString();
      entry.nextRun = new Date(Date.now() + intervalMs).toISOString();
      try {
        await handler();
        logger.debug('Scheduled job executed', { scheduleId: id });
      } catch (err) {
        logger.error('Scheduled job failed', err instanceof Error ? err : new Error(String(err)), { scheduleId: id });
      }
    }, intervalMs);
    this.scheduleEntries.set(id, entry);
    logger.info('Job scheduled', { scheduleId: id, cron, intervalMs });
  }

  unschedule(id: string): boolean {
    const entry = this.scheduleEntries.get(id);
    if (!entry) return false;
    if (entry.timer) clearInterval(entry.timer);
    this.scheduleEntries.delete(id);
    return true;
  }

  private addToWindow(job: InternalJob<T>): void {
    this.windowBuffer.push(job);
    if (this.windowBuffer.length >= this.batchWindow!.maxSize) {
      this.flushWindow();
      return;
    }
    if (!this.windowTimer) {
      this.windowTimer = setTimeout(() => this.flushWindow(), this.batchWindow!.maxWaitMs);
    }
  }

  private flushWindow(): void {
    if (this.windowTimer) { clearTimeout(this.windowTimer); this.windowTimer = null; }
    const jobs = this.windowBuffer.splice(0);
    for (const job of jobs) this.queue.enqueue(job);
    if (jobs.length > 0) {
      logger.debug('Window flushed', { count: jobs.length });
      this.tryProcess();
    }
  }

  private async waitForBackpressure(): Promise<void> {
    if (this.queue.size < this.config.backpressureThreshold) return;
    logger.warn('Backpressure engaged', { queueDepth: this.queue.size, threshold: this.config.backpressureThreshold });
    return new Promise<void>(resolve => {
      this.backpressureWaiters.push(resolve);
    });
  }

  private releaseBackpressure(): void {
    if (this.queue.size < this.config.backpressureThreshold && this.backpressureWaiters.length > 0) {
      const waiters = this.backpressureWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  private tryProcess(): void {
    if (this.state === 'idle' || this.state === 'stopped') return;
    while (this.activeCount < this.config.concurrency && this.queue.size > 0) {
      const job = this.queue.dequeue();
      if (!job) break;
      this.activeCount++;
      this.executeJob(job);
    }
  }

  private async executeJob(job: InternalJob<T>): Promise<void> {
    const start = Date.now();
    job.attempts++;
    try {
      if (this.rateLimiter) await this.rateLimiter.acquire();
      const result = await this.handler(job.data);
      const durationMs = Date.now() - start;
      this.latencies.push(durationMs);
      if (this.latencies.length > 10_000) this.latencies = this.latencies.slice(-5_000);
      this.totalSucceeded++;
      this.completedIds.add(job.id);
      const jobResult: BatchJobResult<R> = { jobId: job.id, success: true, result, attempts: job.attempts, durationMs };
      this.onResult?.(jobResult);
      logger.debug('Job completed', { jobId: job.id, durationMs, attempts: job.attempts });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - start;
      if (job.attempts < job.retryPolicy.maxRetries) {
        this.totalRetries++;
        const delay = computeRetryDelay(job.retryPolicy, job.attempts);
        logger.warn('Job failed, retrying', { jobId: job.id, attempt: job.attempts, nextRetryMs: delay });
        setTimeout(() => {
          this.queue.enqueue(job);
          this.tryProcess();
        }, delay);
      } else {
        this.totalFailed++;
        this.latencies.push(durationMs);
        if (this.latencies.length > 10_000) this.latencies = this.latencies.slice(-5_000);
        const dlEntry: DeadLetterEntry<T> = {
          jobId: job.id, data: job.data, error, attempts: job.attempts,
          failedAt: new Date().toISOString(), metadata: job.metadata,
        };
        this.deadLetterQueue.push(dlEntry);
        this.onDeadLetter?.(dlEntry);
        const jobResult: BatchJobResult<R> = { jobId: job.id, success: false, error, attempts: job.attempts, durationMs };
        this.onResult?.(jobResult);
        logger.error('Job exhausted retries, moved to DLQ', error, { jobId: job.id, attempts: job.attempts });
      }
    } finally {
      this.activeCount--;
      this.releaseBackpressure();
      this.tryProcess();
      if (this.state === 'draining' && this.activeCount === 0 && this.queue.size === 0) {
        logger.info('Drain complete');
        this.state = 'stopped';
        this.drainResolve?.();
        this.drainResolve = null;
      }
    }
  }
}

export class BatchPipeline {
  private stages: PipelineStage<any, any>[] = [];

  addStage<TIn, TOut>(stage: PipelineStage<TIn, TOut>): BatchPipeline {
    this.stages.push(stage);
    return this;
  }

  async execute<TIn>(inputs: TIn[]): Promise<{ results: unknown[]; errors: Array<{ stage: string; index: number; error: Error }> }> {
    let current: unknown[] = inputs;
    const errors: Array<{ stage: string; index: number; error: Error }> = [];
    for (const stage of this.stages) {
      logger.info('Pipeline stage starting', { stage: stage.name, itemCount: current.length });
      const concurrency = stage.concurrency ?? 5;
      const next: unknown[] = [];
      const stageErrors: Array<{ index: number; error: Error }> = [];
      const chunks = chunkArray(current, concurrency);
      for (const chunk of chunks) {
        const settled = await Promise.allSettled(
          chunk.map((item, ci) => executeWithRetry(
            () => stage.handler(item),
            stage.retryPolicy ?? { maxRetries: 1, baseDelayMs: 200, strategy: 'fixed' },
          ).catch(err => { stageErrors.push({ index: ci, error: err instanceof Error ? err : new Error(String(err)) }); return undefined; }),
          ),
        );
        for (const s of settled) {
          if (s.status === 'fulfilled' && s.value !== undefined) next.push(s.value);
        }
      }
      for (const se of stageErrors) errors.push({ stage: stage.name, index: se.index, error: se.error });
      logger.info('Pipeline stage complete', { stage: stage.name, outputCount: next.length, errors: stageErrors.length });
      current = next;
    }
    return { results: current, errors };
  }
}
export interface FanOutConfig<T, R> {
  workers: Array<(item: T) => Promise<R>>;
  reducer: (results: R[]) => Promise<R>;
  concurrency?: number;
}

export async function fanOutFanIn<T, R>(items: T[], config: FanOutConfig<T, R>): Promise<R[]> {
  const concurrency = config.concurrency ?? config.workers.length;
  const allResults: R[] = [];

  for (const item of items) {
    const workerChunks = chunkArray(config.workers, concurrency);
    const workerResults: R[] = [];
    for (const chunk of workerChunks) {
      const settled = await Promise.allSettled(chunk.map(w => w(item)));
      for (const s of settled) {
        if (s.status === 'fulfilled') workerResults.push(s.value);
        else logger.warn('Fan-out worker failed', { error: (s.reason as Error)?.message });
      }
    }
    const reduced = await config.reducer(workerResults);
    allResults.push(reduced);
  }

  return allResults;
}
export interface StreamProcessorConfig<T, R> {
  handler: (item: T) => Promise<R>;
  concurrency?: number;
  highWaterMark?: number;
  onItem?: (result: BatchJobResult<R>) => void;
  retryPolicy?: RetryPolicy;
}

export async function* processStream<T, R>(
  source: AsyncIterable<T>,
  config: StreamProcessorConfig<T, R>,
): AsyncGenerator<BatchJobResult<R>> {
  const concurrency = config.concurrency ?? 5;
  const highWaterMark = config.highWaterMark ?? concurrency * 2;
  const retryPolicy = config.retryPolicy ?? { maxRetries: 2, baseDelayMs: 300, strategy: 'exponential' };

  const pending: Array<Promise<BatchJobResult<R>>> = [];
  let seqId = 0;

  for await (const item of source) {
    const jobId = `stream_${++seqId}`;
    const start = Date.now();
    const task = executeWithRetry(() => config.handler(item), retryPolicy)
      .then<BatchJobResult<R>>(result => ({
        jobId, success: true, result, attempts: 1, durationMs: Date.now() - start,
      }))
      .catch<BatchJobResult<R>>(err => ({
        jobId, success: false, error: err instanceof Error ? err : new Error(String(err)),
        attempts: retryPolicy.maxRetries + 1, durationMs: Date.now() - start,
      }));
    pending.push(task);
    // Backpressure: yield completed items when we hit high water mark
    if (pending.length >= highWaterMark) {
      const completed = await Promise.race(pending.map((p, i) => p.then(r => ({ r, i }))));
      pending.splice(completed.i, 1);
      config.onItem?.(completed.r);
      yield completed.r;
    }
  }

  // Drain remaining
  const remaining = await Promise.allSettled(pending);
  for (const r of remaining) {
    if (r.status === 'fulfilled') {
      config.onItem?.(r.value);
      yield r.value;
    }
  }
}

async function executeWithRetry<R>(fn: () => Promise<R>, policy: RetryPolicy): Promise<R> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < policy.maxRetries) {
        const delay = computeRetryDelay(policy, attempt);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseCronToMs(cron: string): number {
  // Supports: "every Ns" (seconds), "every Nm" (minutes), "every Nh" (hours),
  // or standard 5-field cron where we extract the smallest interval.
  const shorthand = cron.match(/^every\s+(\d+)(s|m|h)$/i);
  if (shorthand) {
    const val = parseInt(shorthand[1], 10);
    switch (shorthand[2].toLowerCase()) {
      case 's': return val * 1000;
      case 'm': return val * 60_000;
      case 'h': return val * 3_600_000;
    }
  }

  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    // Parse minute field for simple */N patterns
    const minuteField = parts[0];
    const everyN = minuteField.match(/^\*\/(\d+)$/);
    if (everyN) return parseInt(everyN[1], 10) * 60_000;
    if (minuteField === '*') return 60_000;
    // Hourly
    const hourField = parts[1];
    const everyH = hourField.match(/^\*\/(\d+)$/);
    if (everyH) return parseInt(everyH[1], 10) * 3_600_000;
    // Default: run once per hour
    return 3_600_000;
  }

  return 0;
}

export function createBatchProcessor<T, R>(config: BatchProcessorConfig<T, R>): BatchProcessor<T, R> {
  const processor = new BatchProcessor<T, R>(config);
  processor.start();
  return processor;
}
