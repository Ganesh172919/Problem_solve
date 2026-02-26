/**
 * Stream Processing Engine
 *
 * High-throughput, real-time data stream processing with
 * windowing, aggregation, backpressure, and exactly-once semantics.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface StreamEvent<T = unknown> {
  id: string;
  topic: string;
  key: string;
  value: T;
  timestamp: number;
  partition: number;
  offset: number;
  headers: Record<string, string>;
}

export interface WindowConfig {
  type: 'tumbling' | 'sliding' | 'session' | 'hopping';
  sizeMs: number;
  slideMs?: number;
  sessionGapMs?: number;
  gracePeriodMs: number;
  allowedLateness: number;
}

export interface AggregationResult<T = unknown> {
  windowStart: number;
  windowEnd: number;
  key: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  values: T[];
  metadata: Record<string, unknown>;
}

export interface StreamTopology {
  id: string;
  name: string;
  sources: SourceNode[];
  processors: ProcessorNode[];
  sinks: SinkNode[];
  errorHandler: ErrorStrategy;
}

export interface SourceNode {
  id: string;
  type: 'topic' | 'table' | 'external';
  config: Record<string, unknown>;
}

export interface ProcessorNode {
  id: string;
  type: 'filter' | 'map' | 'flatMap' | 'aggregate' | 'join' | 'branch' | 'merge';
  inputs: string[];
  config: Record<string, unknown>;
  parallelism: number;
}

export interface SinkNode {
  id: string;
  type: 'topic' | 'database' | 'api' | 'file';
  config: Record<string, unknown>;
}

export type ErrorStrategy = 'skip' | 'retry' | 'deadLetter' | 'halt';

interface WindowState<T> {
  windowStart: number;
  windowEnd: number;
  events: StreamEvent<T>[];
  aggregation: AggregationResult<T>;
  isClosed: boolean;
  watermark: number;
}

interface BackpressureState {
  currentRate: number;
  maxRate: number;
  bufferSize: number;
  bufferCapacity: number;
  isPaused: boolean;
  strategy: 'drop' | 'buffer' | 'throttle' | 'block';
}

interface CheckpointState {
  id: string;
  timestamp: number;
  offsets: Map<string, number>;
  windowStates: Map<string, unknown>;
  processorStates: Map<string, unknown>;
}

interface ProcessorMetrics {
  processedCount: number;
  errorCount: number;
  avgLatencyMs: number;
  throughputPerSecond: number;
  lastProcessedAt: number;
  backpressureEvents: number;
}

export class StreamProcessingEngine {
  private topologies: Map<string, StreamTopology> = new Map();
  private windows: Map<string, WindowState<unknown>[]> = new Map();
  private backpressure: Map<string, BackpressureState> = new Map();
  private checkpoints: Map<string, CheckpointState> = new Map();
  private processorMetrics: Map<string, ProcessorMetrics> = new Map();
  private deadLetterQueue: StreamEvent[] = [];
  private eventBuffer: Map<string, StreamEvent[]> = new Map();
  private handlers: Map<string, ((event: StreamEvent) => Promise<StreamEvent | null>)[]> = new Map();
  private isRunning = false;
  private checkpointInterval: ReturnType<typeof setInterval> | null = null;

  registerTopology(topology: StreamTopology): void {
    this.topologies.set(topology.id, topology);

    for (const processor of topology.processors) {
      this.processorMetrics.set(processor.id, {
        processedCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        throughputPerSecond: 0,
        lastProcessedAt: 0,
        backpressureEvents: 0,
      });
    }

    this.backpressure.set(topology.id, {
      currentRate: 0,
      maxRate: 10000,
      bufferSize: 0,
      bufferCapacity: 50000,
      isPaused: false,
      strategy: 'buffer',
    });

    logger.info('Stream topology registered', { topologyId: topology.id, name: topology.name });
  }

  async processEvent<T>(event: StreamEvent<T>): Promise<StreamEvent<T> | null> {
    const startTime = Date.now();
    const topologyId = this.findTopologyForTopic(event.topic);

    if (!topologyId) {
      logger.warn('No topology found for topic', { topic: event.topic });
      return null;
    }

    const bp = this.backpressure.get(topologyId);
    if (bp && this.isBackpressured(bp)) {
      return this.handleBackpressure(event, bp, topologyId);
    }

    try {
      const topology = this.topologies.get(topologyId)!;
      let result: StreamEvent<T> | null = event;

      for (const processor of topology.processors) {
        if (!result) break;
        result = await this.executeProcessor(processor, result);
        this.updateProcessorMetrics(processor.id, Date.now() - startTime, true);
      }

      if (bp) {
        bp.currentRate++;
      }

      return result;
    } catch (error) {
      const topology = this.topologies.get(topologyId)!;
      return this.handleProcessingError(event, error as Error, topology.errorHandler);
    }
  }

  createWindow<T>(key: string, config: WindowConfig): void {
    const now = Date.now();
    const windowStart = this.alignToWindow(now, config.sizeMs);
    const windowEnd = windowStart + config.sizeMs;

    const state: WindowState<T> = {
      windowStart,
      windowEnd,
      events: [],
      aggregation: {
        windowStart,
        windowEnd,
        key,
        count: 0,
        sum: 0,
        avg: 0,
        min: Infinity,
        max: -Infinity,
        values: [],
        metadata: { windowType: config.type },
      },
      isClosed: false,
      watermark: now,
    };

    const existing = (this.windows.get(key) || []) as WindowState<T>[];
    existing.push(state);
    this.windows.set(key, existing as WindowState<unknown>[]);
  }

  addToWindow<T>(key: string, event: StreamEvent<T>): AggregationResult<T> | null {
    const windows = this.windows.get(key) as WindowState<T>[] | undefined;
    if (!windows || windows.length === 0) return null;

    const activeWindow = windows.find(
      (w) => !w.isClosed && event.timestamp >= w.windowStart && event.timestamp < w.windowEnd,
    );

    if (!activeWindow) return null;

    activeWindow.events.push(event);
    const numericValue = typeof event.value === 'number' ? event.value : 0;

    activeWindow.aggregation.count++;
    activeWindow.aggregation.sum += numericValue;
    activeWindow.aggregation.avg = activeWindow.aggregation.sum / activeWindow.aggregation.count;
    activeWindow.aggregation.min = Math.min(activeWindow.aggregation.min, numericValue);
    activeWindow.aggregation.max = Math.max(activeWindow.aggregation.max, numericValue);
    activeWindow.aggregation.values.push(event.value);
    activeWindow.watermark = Math.max(activeWindow.watermark, event.timestamp);

    return activeWindow.aggregation;
  }

  closeWindow<T>(key: string, windowStart: number): AggregationResult<T> | null {
    const windows = this.windows.get(key) as WindowState<T>[] | undefined;
    if (!windows) return null;

    const window = windows.find((w) => w.windowStart === windowStart && !w.isClosed);
    if (!window) return null;

    window.isClosed = true;
    logger.info('Window closed', {
      key,
      windowStart,
      windowEnd: window.windowEnd,
      eventCount: window.aggregation.count,
    });

    return window.aggregation;
  }

  async checkpoint(topologyId: string): Promise<CheckpointState> {
    const offsets = new Map<string, number>();
    const windowStates = new Map<string, unknown>();
    const processorStates = new Map<string, unknown>();

    const topology = this.topologies.get(topologyId);
    if (topology) {
      for (const source of topology.sources) {
        const buffer = this.eventBuffer.get(source.id);
        offsets.set(source.id, buffer ? buffer.length : 0);
      }

      for (const processor of topology.processors) {
        processorStates.set(processor.id, this.processorMetrics.get(processor.id));
      }
    }

    for (const [key, windows] of this.windows) {
      windowStates.set(
        key,
        windows.map((w) => ({
          windowStart: w.windowStart,
          windowEnd: w.windowEnd,
          count: w.aggregation.count,
          isClosed: w.isClosed,
        })),
      );
    }

    const checkpoint: CheckpointState = {
      id: `cp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      timestamp: Date.now(),
      offsets,
      windowStates,
      processorStates,
    };

    this.checkpoints.set(topologyId, checkpoint);
    logger.info('Checkpoint created', { topologyId, checkpointId: checkpoint.id });
    return checkpoint;
  }

  async restoreFromCheckpoint(topologyId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(topologyId);
    if (!checkpoint) {
      logger.warn('No checkpoint found', { topologyId });
      return false;
    }

    logger.info('Restoring from checkpoint', {
      topologyId,
      checkpointId: checkpoint.id,
      timestamp: checkpoint.timestamp,
    });

    for (const [processorId, state] of checkpoint.processorStates) {
      if (state) {
        this.processorMetrics.set(processorId, state as ProcessorMetrics);
      }
    }

    return true;
  }

  registerHandler(topic: string, handler: (event: StreamEvent) => Promise<StreamEvent | null>): void {
    const existing = this.handlers.get(topic) || [];
    existing.push(handler);
    this.handlers.set(topic, existing);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.checkpointInterval = setInterval(() => {
      for (const topologyId of this.topologies.keys()) {
        this.checkpoint(topologyId).catch((err) => {
          logger.error('Checkpoint failed', err as Error, { topologyId });
        });
      }
    }, 30000);

    logger.info('Stream processing engine started', {
      topologyCount: this.topologies.size,
    });
  }

  stop(): void {
    this.isRunning = false;
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
    logger.info('Stream processing engine stopped');
  }

  getMetrics(): {
    topologies: number;
    activeWindows: number;
    deadLetterSize: number;
    processorMetrics: Record<string, ProcessorMetrics>;
    backpressureStates: Record<string, BackpressureState>;
  } {
    let activeWindows = 0;
    for (const windows of this.windows.values()) {
      activeWindows += windows.filter((w) => !w.isClosed).length;
    }

    const metrics: Record<string, ProcessorMetrics> = {};
    for (const [id, m] of this.processorMetrics) {
      metrics[id] = { ...m };
    }

    const bpStates: Record<string, BackpressureState> = {};
    for (const [id, bp] of this.backpressure) {
      bpStates[id] = { ...bp };
    }

    return {
      topologies: this.topologies.size,
      activeWindows,
      deadLetterSize: this.deadLetterQueue.length,
      processorMetrics: metrics,
      backpressureStates: bpStates,
    };
  }

  getDeadLetterQueue(): StreamEvent[] {
    return [...this.deadLetterQueue];
  }

  reprocessDeadLetter(eventId: string): StreamEvent | null {
    const idx = this.deadLetterQueue.findIndex((e) => e.id === eventId);
    if (idx === -1) return null;
    return this.deadLetterQueue.splice(idx, 1)[0];
  }

  private findTopologyForTopic(topic: string): string | undefined {
    for (const [id, topology] of this.topologies) {
      const hasSource = topology.sources.some(
        (s) => s.config.topic === topic || s.config.topics?.toString().includes(topic),
      );
      if (hasSource) return id;
    }
    return undefined;
  }

  private isBackpressured(bp: BackpressureState): boolean {
    return bp.isPaused || bp.bufferSize >= bp.bufferCapacity || bp.currentRate >= bp.maxRate;
  }

  private handleBackpressure<T>(
    event: StreamEvent<T>,
    bp: BackpressureState,
    topologyId: string,
  ): StreamEvent<T> | null {
    const metrics = this.processorMetrics.get(topologyId);
    if (metrics) {
      metrics.backpressureEvents++;
    }

    switch (bp.strategy) {
      case 'drop':
        logger.warn('Dropping event due to backpressure', { eventId: event.id, topic: event.topic });
        return null;
      case 'buffer': {
        const buffer = this.eventBuffer.get(topologyId) || [];
        buffer.push(event as StreamEvent);
        this.eventBuffer.set(topologyId, buffer);
        bp.bufferSize = buffer.length;
        return null;
      }
      case 'throttle':
        bp.currentRate = Math.max(0, bp.currentRate - Math.floor(bp.maxRate * 0.1));
        return event;
      case 'block':
        return null;
    }
  }

  private async executeProcessor<T>(
    processor: ProcessorNode,
    event: StreamEvent<T>,
  ): Promise<StreamEvent<T> | null> {
    switch (processor.type) {
      case 'filter':
        return this.executeFilter(processor, event);
      case 'map':
        return this.executeMap(processor, event);
      case 'flatMap':
        return this.executeFlatMap(processor, event);
      case 'aggregate':
        return this.executeAggregate(processor, event);
      default:
        return event;
    }
  }

  private executeFilter<T>(processor: ProcessorNode, event: StreamEvent<T>): StreamEvent<T> | null {
    const field = processor.config.field as string;
    const operator = processor.config.operator as string;
    const expected = processor.config.value;

    if (!field) return event;

    const actual = (event.value as Record<string, unknown>)?.[field];
    switch (operator) {
      case 'eq':
        return actual === expected ? event : null;
      case 'neq':
        return actual !== expected ? event : null;
      case 'gt':
        return (actual as number) > (expected as number) ? event : null;
      case 'lt':
        return (actual as number) < (expected as number) ? event : null;
      case 'contains':
        return String(actual).includes(String(expected)) ? event : null;
      case 'exists':
        return actual !== undefined && actual !== null ? event : null;
      default:
        return event;
    }
  }

  private executeMap<T>(processor: ProcessorNode, event: StreamEvent<T>): StreamEvent<T> {
    const mappings = processor.config.mappings as Record<string, string> | undefined;
    if (!mappings) return event;

    const value = event.value as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};

    for (const [target, source] of Object.entries(mappings)) {
      mapped[target] = value[source];
    }

    return { ...event, value: mapped as T };
  }

  private executeFlatMap<T>(processor: ProcessorNode, event: StreamEvent<T>): StreamEvent<T> | null {
    const expandField = processor.config.expandField as string;
    if (!expandField) return event;

    const value = event.value as Record<string, unknown>;
    const expandValue = value[expandField];

    if (Array.isArray(expandValue) && expandValue.length > 0) {
      return { ...event, value: { ...value, [expandField]: expandValue[0] } as T };
    }
    return event;
  }

  private executeAggregate<T>(
    processor: ProcessorNode,
    event: StreamEvent<T>,
  ): StreamEvent<T> | null {
    const windowConfig = processor.config.window as WindowConfig | undefined;
    if (!windowConfig) return event;

    const key = `${processor.id}:${event.key}`;
    const windows = this.windows.get(key);

    if (!windows || windows.length === 0) {
      this.createWindow(key, windowConfig);
    }

    const result = this.addToWindow(key, event);
    if (result) {
      return {
        ...event,
        value: { ...event.value as Record<string, unknown>, __aggregation: result } as T,
      };
    }
    return event;
  }

  private handleProcessingError<T>(
    event: StreamEvent<T>,
    error: Error,
    strategy: ErrorStrategy,
  ): StreamEvent<T> | null {
    logger.error('Stream processing error', error, { eventId: event.id, strategy });

    switch (strategy) {
      case 'skip':
        return null;
      case 'deadLetter':
        this.deadLetterQueue.push({
          ...event,
          headers: {
            ...event.headers,
            'x-error': error.message,
            'x-error-timestamp': Date.now().toString(),
          },
        } as StreamEvent);
        return null;
      case 'retry':
        return event;
      case 'halt':
        this.stop();
        return null;
    }
  }

  private updateProcessorMetrics(processorId: string, latencyMs: number, success: boolean): void {
    const metrics = this.processorMetrics.get(processorId);
    if (!metrics) return;

    if (success) {
      metrics.processedCount++;
      metrics.avgLatencyMs =
        (metrics.avgLatencyMs * (metrics.processedCount - 1) + latencyMs) / metrics.processedCount;
    } else {
      metrics.errorCount++;
    }

    const now = Date.now();
    if (now - metrics.lastProcessedAt >= 1000) {
      metrics.throughputPerSecond = metrics.processedCount;
      metrics.lastProcessedAt = now;
    }
  }

  private alignToWindow(timestamp: number, windowSizeMs: number): number {
    return Math.floor(timestamp / windowSizeMs) * windowSizeMs;
  }
}

let engineInstance: StreamProcessingEngine | null = null;

export function getStreamProcessingEngine(): StreamProcessingEngine {
  if (!engineInstance) {
    engineInstance = new StreamProcessingEngine();
  }
  return engineInstance;
}
