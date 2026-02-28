/**
 * @module selfOptimizingPipeline
 * @description Autonomous self-optimizing data processing pipeline that monitors
 * its own performance, identifies bottlenecks, dynamically adjusts parallelism,
 * batching strategies, and resource allocation to maintain optimal throughput.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type StageStatus = 'idle' | 'running' | 'saturated' | 'degraded' | 'paused';
export type OptimizationAction =
  | 'increase_parallelism'
  | 'decrease_parallelism'
  | 'increase_batch_size'
  | 'decrease_batch_size'
  | 'add_buffer'
  | 'flush_buffer'
  | 'circuit_break'
  | 'resume'
  | 'reorder_stages';

export interface PipelineStageConfig {
  id: string;
  name: string;
  processorFn: (batch: unknown[]) => Promise<unknown[]>;
  minParallelism: number;
  maxParallelism: number;
  targetLatencyMs: number;
  maxBatchSize: number;
  minBatchSize: number;
  bufferSize: number;
}

export interface StageMetrics {
  stageId: string;
  status: StageStatus;
  currentParallelism: number;
  currentBatchSize: number;
  processedItems: number;
  failedItems: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  throughputPerSec: number;
  bufferDepth: number;
  backpressure: boolean;
  lastOptimizedAt: number;
}

export interface PipelineMetrics {
  pipelineId: string;
  stages: Map<string, StageMetrics>;
  totalThroughputPerSec: number;
  e2eLatencyMs: number;
  overallHealth: 'healthy' | 'degraded' | 'critical';
  optimizationCount: number;
  lastOptimizationAction?: OptimizationAction;
}

export interface OptimizationDecision {
  stageId: string;
  action: OptimizationAction;
  reason: string;
  before: { parallelism: number; batchSize: number };
  after: { parallelism: number; batchSize: number };
  expectedImprovementPct: number;
}

// ── Stage Implementation ──────────────────────────────────────────────────────

class PipelineStage {
  readonly config: PipelineStageConfig;
  private buffer: unknown[] = [];
  private latencyHistory: number[] = [];
  private processedCount = 0;
  private failedCount = 0;
  private currentParallelism: number;
  private currentBatchSize: number;
  private status: StageStatus = 'idle';
  private throughputWindow: number[] = [];
  private lastThroughputReset = Date.now();
  private activeWorkers = 0;

  constructor(config: PipelineStageConfig) {
    this.config = config;
    this.currentParallelism = config.minParallelism;
    this.currentBatchSize = config.minBatchSize;
  }

  enqueue(items: unknown[]): void {
    const available = this.config.bufferSize - this.buffer.length;
    const toAdd = items.slice(0, available);
    this.buffer.push(...toAdd);
  }

  async drainBatch(): Promise<unknown[]> {
    if (this.buffer.length === 0) return [];
    const batch = this.buffer.splice(0, this.currentBatchSize);
    const start = Date.now();
    this.status = 'running';
    this.activeWorkers++;

    try {
      const result = await this.config.processorFn(batch);
      const latency = Date.now() - start;
      this.latencyHistory.push(latency);
      if (this.latencyHistory.length > 100) this.latencyHistory.shift();
      this.processedCount += batch.length;
      this.throughputWindow.push(batch.length);
      return result;
    } catch {
      this.failedCount += batch.length;
      return [];
    } finally {
      this.activeWorkers--;
      if (this.buffer.length === 0 && this.activeWorkers === 0) this.status = 'idle';
    }
  }

  setParallelism(p: number): void {
    this.currentParallelism = Math.max(
      this.config.minParallelism,
      Math.min(this.config.maxParallelism, p)
    );
  }

  setBatchSize(s: number): void {
    this.currentBatchSize = Math.max(
      this.config.minBatchSize,
      Math.min(this.config.maxBatchSize, s)
    );
  }

  getMetrics(): StageMetrics {
    const sorted = [...this.latencyHistory].sort((a, b) => a - b);
    const avg = sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

    const now = Date.now();
    const windowMs = now - this.lastThroughputReset;
    const windowItems = this.throughputWindow.reduce((s, v) => s + v, 0);
    const throughput = windowMs > 0 ? (windowItems / windowMs) * 1000 : 0;
    if (windowMs > 5000) {
      this.throughputWindow = [];
      this.lastThroughputReset = now;
    }

    return {
      stageId: this.config.id,
      status: this.status,
      currentParallelism: this.currentParallelism,
      currentBatchSize: this.currentBatchSize,
      processedItems: this.processedCount,
      failedItems: this.failedCount,
      avgLatencyMs: avg,
      p99LatencyMs: p99,
      throughputPerSec: throughput,
      bufferDepth: this.buffer.length,
      backpressure: this.buffer.length > this.config.bufferSize * 0.8,
      lastOptimizedAt: 0,
    };
  }

  getParallelism(): number { return this.currentParallelism; }
  getBatchSize(): number { return this.currentBatchSize; }
  getBufferDepth(): number { return this.buffer.length; }
  getAvgLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    return this.latencyHistory.reduce((s, v) => s + v, 0) / this.latencyHistory.length;
  }
}

// ── Optimizer ─────────────────────────────────────────────────────────────────

class PipelineOptimizer {
  optimize(stage: PipelineStage, metrics: StageMetrics): OptimizationDecision | null {
    const config = stage.config;
    const before = { parallelism: metrics.currentParallelism, batchSize: metrics.currentBatchSize };

    // High latency - reduce batch size or increase parallelism
    if (metrics.avgLatencyMs > config.targetLatencyMs * 1.5) {
      if (metrics.currentParallelism < config.maxParallelism) {
        const newP = Math.min(config.maxParallelism, metrics.currentParallelism + 1);
        return {
          stageId: config.id,
          action: 'increase_parallelism',
          reason: `Avg latency ${metrics.avgLatencyMs.toFixed(0)}ms exceeds target ${config.targetLatencyMs}ms`,
          before,
          after: { parallelism: newP, batchSize: metrics.currentBatchSize },
          expectedImprovementPct: Math.min(50, (metrics.avgLatencyMs - config.targetLatencyMs) / metrics.avgLatencyMs * 100),
        };
      }
      if (metrics.currentBatchSize > config.minBatchSize) {
        const newBatch = Math.max(config.minBatchSize, Math.floor(metrics.currentBatchSize * 0.75));
        return {
          stageId: config.id,
          action: 'decrease_batch_size',
          reason: `High latency with max parallelism - reducing batch size`,
          before,
          after: { parallelism: metrics.currentParallelism, batchSize: newBatch },
          expectedImprovementPct: 20,
        };
      }
    }

    // Low latency, high throughput - increase batch size
    if (metrics.avgLatencyMs < config.targetLatencyMs * 0.5 &&
        metrics.throughputPerSec > 0 &&
        metrics.currentBatchSize < config.maxBatchSize) {
      const newBatch = Math.min(config.maxBatchSize, Math.ceil(metrics.currentBatchSize * 1.5));
      return {
        stageId: config.id,
        action: 'increase_batch_size',
        reason: `Latency well below target - increasing batch size for efficiency`,
        before,
        after: { parallelism: metrics.currentParallelism, batchSize: newBatch },
        expectedImprovementPct: 15,
      };
    }

    // Backpressure detected
    if (metrics.backpressure && metrics.currentParallelism < config.maxParallelism) {
      const newP = Math.min(config.maxParallelism, metrics.currentParallelism + 2);
      return {
        stageId: config.id,
        action: 'increase_parallelism',
        reason: `Buffer at ${(metrics.bufferDepth / config.bufferSize * 100).toFixed(0)}% capacity`,
        before,
        after: { parallelism: newP, batchSize: metrics.currentBatchSize },
        expectedImprovementPct: 30,
      };
    }

    // Over-provisioned - scale down
    if (metrics.avgLatencyMs < config.targetLatencyMs * 0.3 &&
        metrics.currentParallelism > config.minParallelism &&
        !metrics.backpressure) {
      const newP = Math.max(config.minParallelism, metrics.currentParallelism - 1);
      return {
        stageId: config.id,
        action: 'decrease_parallelism',
        reason: `Over-provisioned: latency ${metrics.avgLatencyMs.toFixed(0)}ms far below target`,
        before,
        after: { parallelism: newP, batchSize: metrics.currentBatchSize },
        expectedImprovementPct: 10,
      };
    }

    return null;
  }
}

// ── Core Pipeline ─────────────────────────────────────────────────────────────

export class SelfOptimizingPipeline {
  private stages = new Map<string, PipelineStage>();
  private stageOrder: string[] = [];
  private optimizer = new PipelineOptimizer();
  private optimizationCount = 0;
  private lastOptimizationAction: OptimizationAction | undefined;
  private optimizationInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  addStage(config: PipelineStageConfig): void {
    this.stages.set(config.id, new PipelineStage(config));
    this.stageOrder.push(config.id);
    logger.info('Pipeline stage added', { pipelineId: this.id, stageId: config.id });
  }

  start(): void {
    this.running = true;
    this.optimizationInterval = setInterval(() => this.runOptimizationCycle(), 10_000);
    logger.info('Pipeline started', { pipelineId: this.id, stages: this.stageOrder.length });
  }

  stop(): void {
    this.running = false;
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = null;
    }
    logger.info('Pipeline stopped', { pipelineId: this.id });
  }

  async process(items: unknown[]): Promise<unknown[]> {
    let current = items;

    for (const stageId of this.stageOrder) {
      const stage = this.stages.get(stageId);
      if (!stage) continue;

      stage.enqueue(current);

      // Fan out with current parallelism
      const batches: Promise<unknown[]>[] = [];
      for (let i = 0; i < stage.getParallelism(); i++) {
        if (stage.getBufferDepth() === 0) break;
        batches.push(stage.drainBatch());
      }

      const results = await Promise.all(batches);
      current = results.flat();
    }

    return current;
  }

  private runOptimizationCycle(): void {
    for (const stageId of this.stageOrder) {
      const stage = this.stages.get(stageId);
      if (!stage) continue;

      const metrics = stage.getMetrics();
      const decision = this.optimizer.optimize(stage, metrics);

      if (decision) {
        stage.setParallelism(decision.after.parallelism);
        stage.setBatchSize(decision.after.batchSize);
        this.optimizationCount++;
        this.lastOptimizationAction = decision.action;

        logger.info('Pipeline optimized', {
          pipelineId: this.id,
          stageId,
          action: decision.action,
          reason: decision.reason,
          before: decision.before,
          after: decision.after,
        });
      }
    }
  }

  getMetrics(): PipelineMetrics {
    const stageMetrics = new Map<string, StageMetrics>();
    let totalThroughput = 0;
    let totalLatency = 0;
    let degradedCount = 0;

    for (const [id, stage] of this.stages.entries()) {
      const m = stage.getMetrics();
      stageMetrics.set(id, m);
      totalThroughput += m.throughputPerSec;
      totalLatency += m.avgLatencyMs;
      if (m.status === 'degraded' || m.status === 'saturated') degradedCount++;
    }

    const overallHealth: PipelineMetrics['overallHealth'] =
      degradedCount === 0 ? 'healthy' :
      degradedCount < this.stages.size / 2 ? 'degraded' : 'critical';

    return {
      pipelineId: this.id,
      stages: stageMetrics,
      totalThroughputPerSec: totalThroughput,
      e2eLatencyMs: totalLatency,
      overallHealth,
      optimizationCount: this.optimizationCount,
      lastOptimizationAction: this.lastOptimizationAction,
    };
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class PipelineRegistry {
  private pipelines = new Map<string, SelfOptimizingPipeline>();

  create(id: string): SelfOptimizingPipeline {
    const pipeline = new SelfOptimizingPipeline(id);
    this.pipelines.set(id, pipeline);
    return pipeline;
  }

  get(id: string): SelfOptimizingPipeline | undefined {
    return this.pipelines.get(id);
  }

  list(): SelfOptimizingPipeline[] {
    return Array.from(this.pipelines.values());
  }

  getAllMetrics(): Map<string, PipelineMetrics> {
    const result = new Map<string, PipelineMetrics>();
    for (const [id, pipeline] of this.pipelines.entries()) {
      result.set(id, pipeline.getMetrics());
    }
    return result;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
   
  var __pipelineRegistry__: PipelineRegistry | undefined;
}

export function getPipelineRegistry(): PipelineRegistry {
  if (!globalThis.__pipelineRegistry__) {
    globalThis.__pipelineRegistry__ = new PipelineRegistry();
  }
  return globalThis.__pipelineRegistry__;
}
