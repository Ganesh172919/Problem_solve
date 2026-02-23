import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventHandler<T = unknown> {
  id: string;
  callback: (payload: T) => void | Promise<void>;
  priority: number;
  filter?: (payload: T) => boolean;
  once: boolean;
}

interface StoredEvent<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface DeadLetterEntry {
  event: StoredEvent;
  handlerId: string;
  error: string;
  timestamp: number;
  retryCount: number;
}

interface EventBusMetrics {
  eventsPublished: number;
  handlersInvoked: number;
  failures: number;
  deadLetterSize: number;
  activeSubscriptions: number;
  eventStoreSize: number;
}

interface SubscribeOptions<T = unknown> {
  priority?: number;
  filter?: (payload: T) => boolean;
  once?: boolean;
}

type UnsubscribeFn = () => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let handlerCounter = 0;
let eventCounter = 0;

function generateHandlerId(): string {
  return `handler_${Date.now()}_${++handlerCounter}`;
}

function generateEventId(): string {
  return `evt_${Date.now()}_${++eventCounter}`;
}

function matchesWildcard(pattern: string, topic: string): boolean {
  if (pattern === '*') return true;
  if (pattern === topic) return true;

  const patternParts = pattern.split('.');
  const topicParts = topic.split('.');

  let pi = 0;
  let ti = 0;

  while (pi < patternParts.length && ti < topicParts.length) {
    const pp = patternParts[pi];

    if (pp === '**') {
      // ** matches zero or more segments
      if (pi === patternParts.length - 1) return true;
      // Try matching remaining pattern against every suffix of topic
      for (let k = ti; k <= topicParts.length; k++) {
        if (matchesWildcard(patternParts.slice(pi + 1).join('.'), topicParts.slice(k).join('.'))) {
          return true;
        }
      }
      return false;
    }

    if (pp === '*') {
      // single-segment wildcard
      pi++;
      ti++;
      continue;
    }

    if (pp !== topicParts[ti]) return false;
    pi++;
    ti++;
  }

  return pi === patternParts.length && ti === topicParts.length;
}

// ─── EventBus ─────────────────────────────────────────────────────────────────

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private eventStore: StoredEvent[] = [];
  private deadLetterQueue: DeadLetterEntry[] = [];
  private metrics: EventBusMetrics = {
    eventsPublished: 0,
    handlersInvoked: 0,
    failures: 0,
    deadLetterSize: 0,
    activeSubscriptions: 0,
    eventStoreSize: 0,
  };
  private maxEventStoreSize: number;
  private maxDeadLetterSize: number;
  private maxDeadLetterRetries: number;

  constructor(options?: {
    maxEventStoreSize?: number;
    maxDeadLetterSize?: number;
    maxDeadLetterRetries?: number;
  }) {
    this.maxEventStoreSize = options?.maxEventStoreSize ?? 10000;
    this.maxDeadLetterSize = options?.maxDeadLetterSize ?? 1000;
    this.maxDeadLetterRetries = options?.maxDeadLetterRetries ?? 3;
    logger.info('EventBus initialized', {
      maxEventStoreSize: this.maxEventStoreSize,
      maxDeadLetterSize: this.maxDeadLetterSize,
    });
  }

  subscribe<T = unknown>(
    topic: string,
    callback: (payload: T) => void | Promise<void>,
    options?: SubscribeOptions<T>,
  ): UnsubscribeFn {
    if (!topic || typeof callback !== 'function') {
      throw new Error('EventBus.subscribe requires a valid topic and callback');
    }

    const handler: EventHandler<T> = {
      id: generateHandlerId(),
      callback: callback as (payload: unknown) => void | Promise<void>,
      priority: options?.priority ?? 0,
      filter: options?.filter as ((payload: unknown) => boolean) | undefined,
      once: options?.once ?? false,
    };

    const existing = this.handlers.get(topic) ?? [];
    existing.push(handler as EventHandler);
    // Sort descending by priority so higher priority runs first
    existing.sort((a, b) => b.priority - a.priority);
    this.handlers.set(topic, existing);
    this.metrics.activeSubscriptions++;

    logger.debug('EventBus: handler subscribed', { topic, handlerId: handler.id, priority: handler.priority });

    return () => this.unsubscribe(topic, handler.id);
  }

  subscribeOnce<T = unknown>(
    topic: string,
    callback: (payload: T) => void | Promise<void>,
    options?: Omit<SubscribeOptions<T>, 'once'>,
  ): UnsubscribeFn {
    return this.subscribe(topic, callback, { ...options, once: true });
  }

  unsubscribe(topic: string, handlerId: string): boolean {
    const handlers = this.handlers.get(topic);
    if (!handlers) return false;

    const idx = handlers.findIndex((h) => h.id === handlerId);
    if (idx === -1) return false;

    handlers.splice(idx, 1);
    this.metrics.activeSubscriptions = Math.max(0, this.metrics.activeSubscriptions - 1);

    if (handlers.length === 0) {
      this.handlers.delete(topic);
    }

    logger.debug('EventBus: handler unsubscribed', { topic, handlerId });
    return true;
  }

  unsubscribeAll(topic?: string): void {
    if (topic) {
      const count = this.handlers.get(topic)?.length ?? 0;
      this.handlers.delete(topic);
      this.metrics.activeSubscriptions = Math.max(0, this.metrics.activeSubscriptions - count);
      logger.info('EventBus: all handlers removed for topic', { topic, count });
    } else {
      this.handlers.clear();
      this.metrics.activeSubscriptions = 0;
      logger.info('EventBus: all handlers removed');
    }
  }

  publish<T = unknown>(topic: string, payload: T, metadata?: Record<string, unknown>): void {
    const storedEvent = this.storeEvent(topic, payload, metadata);
    const matchingHandlers = this.resolveHandlers(topic);

    if (matchingHandlers.length === 0) {
      logger.debug('EventBus: no handlers for topic', { topic });
    }

    this.metrics.eventsPublished++;
    const toRemove: Array<{ topic: string; handlerId: string }> = [];

    for (const { pattern, handler } of matchingHandlers) {
      if (handler.filter) {
        try {
          if (!handler.filter(payload)) continue;
        } catch {
          logger.warn('EventBus: filter threw an error, skipping handler', {
            topic,
            handlerId: handler.id,
          });
          continue;
        }
      }

      try {
        const result = handler.callback(payload);
        // If the handler returns a promise in sync publish, we catch errors but don't await
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            this.handleFailure(storedEvent, handler.id, error);
          });
        }
        this.metrics.handlersInvoked++;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.handleFailure(storedEvent, handler.id, error);
      }

      if (handler.once) {
        toRemove.push({ topic: pattern, handlerId: handler.id });
      }
    }

    for (const { topic: t, handlerId } of toRemove) {
      this.unsubscribe(t, handlerId);
    }
  }

  async publishAsync<T = unknown>(
    topic: string,
    payload: T,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const storedEvent = this.storeEvent(topic, payload, metadata);
    const matchingHandlers = this.resolveHandlers(topic);

    this.metrics.eventsPublished++;
    const toRemove: Array<{ topic: string; handlerId: string }> = [];

    for (const { pattern, handler } of matchingHandlers) {
      if (handler.filter) {
        try {
          if (!handler.filter(payload)) continue;
        } catch {
          logger.warn('EventBus: filter error in async publish', { topic, handlerId: handler.id });
          continue;
        }
      }

      try {
        await handler.callback(payload);
        this.metrics.handlersInvoked++;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.handleFailure(storedEvent, handler.id, error);
      }

      if (handler.once) {
        toRemove.push({ topic: pattern, handlerId: handler.id });
      }
    }

    for (const { topic: t, handlerId } of toRemove) {
      this.unsubscribe(t, handlerId);
    }
  }

  replay(
    topic: string,
    callback: (payload: unknown) => void | Promise<void>,
    options?: { since?: number; until?: number; limit?: number },
  ): number {
    const since = options?.since ?? 0;
    const until = options?.until ?? Date.now();
    const limit = options?.limit ?? Infinity;

    let replayed = 0;
    for (const event of this.eventStore) {
      if (replayed >= limit) break;
      if (!matchesWildcard(topic, event.topic)) continue;
      if (event.timestamp < since || event.timestamp > until) continue;

      try {
        const result = callback(event.payload);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err: unknown) => {
            logger.error('EventBus: replay handler error', err instanceof Error ? err : new Error(String(err)), {
              eventId: event.id,
            });
          });
        }
        replayed++;
      } catch (err: unknown) {
        logger.error(
          'EventBus: replay handler threw',
          err instanceof Error ? err : new Error(String(err)),
          { eventId: event.id },
        );
      }
    }

    logger.info('EventBus: replay completed', { topic, replayed });
    return replayed;
  }

  retryDeadLetters(topic?: string, maxRetries?: number): number {
    const max = maxRetries ?? this.maxDeadLetterRetries;
    const toRetry = topic
      ? this.deadLetterQueue.filter((d) => matchesWildcard(topic, d.event.topic) && d.retryCount < max)
      : this.deadLetterQueue.filter((d) => d.retryCount < max);

    let retried = 0;
    const remaining: DeadLetterEntry[] = [];

    for (const entry of this.deadLetterQueue) {
      const shouldRetry = toRetry.includes(entry);
      if (!shouldRetry) {
        remaining.push(entry);
        continue;
      }

      // Re-publish the event
      entry.retryCount++;
      try {
        this.publish(entry.event.topic, entry.event.payload, entry.event.metadata);
        retried++;
      } catch {
        remaining.push(entry);
      }
    }

    this.deadLetterQueue = remaining;
    this.metrics.deadLetterSize = this.deadLetterQueue.length;
    logger.info('EventBus: dead letter retry completed', { retried, remaining: remaining.length });
    return retried;
  }

  getDeadLetterQueue(): ReadonlyArray<DeadLetterEntry> {
    return [...this.deadLetterQueue];
  }

  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    this.metrics.deadLetterSize = 0;
    return count;
  }

  getEventStore(): ReadonlyArray<StoredEvent> {
    return [...this.eventStore];
  }

  clearEventStore(): void {
    this.eventStore = [];
    this.metrics.eventStoreSize = 0;
  }

  getMetrics(): EventBusMetrics {
    return { ...this.metrics };
  }

  getTopics(): string[] {
    return Array.from(this.handlers.keys());
  }

  getHandlerCount(topic?: string): number {
    if (topic) {
      return this.handlers.get(topic)?.length ?? 0;
    }
    let total = 0;
    for (const handlers of this.handlers.values()) {
      total += handlers.length;
    }
    return total;
  }

  destroy(): void {
    this.handlers.clear();
    this.eventStore = [];
    this.deadLetterQueue = [];
    this.metrics = {
      eventsPublished: 0,
      handlersInvoked: 0,
      failures: 0,
      deadLetterSize: 0,
      activeSubscriptions: 0,
      eventStoreSize: 0,
    };
    logger.info('EventBus destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private resolveHandlers(topic: string): Array<{ pattern: string; handler: EventHandler }> {
    const result: Array<{ pattern: string; handler: EventHandler }> = [];

    for (const [pattern, handlers] of this.handlers.entries()) {
      if (matchesWildcard(pattern, topic)) {
        for (const handler of handlers) {
          result.push({ pattern, handler });
        }
      }
    }

    // Stable sort by priority descending across all matched patterns
    result.sort((a, b) => b.handler.priority - a.handler.priority);
    return result;
  }

  private storeEvent<T>(topic: string, payload: T, metadata?: Record<string, unknown>): StoredEvent<T> {
    const event: StoredEvent<T> = {
      id: generateEventId(),
      topic,
      payload,
      timestamp: Date.now(),
      metadata,
    };

    this.eventStore.push(event as StoredEvent);
    this.metrics.eventStoreSize = this.eventStore.length;

    // Evict oldest events when store exceeds max size
    if (this.eventStore.length > this.maxEventStoreSize) {
      const evictCount = Math.floor(this.maxEventStoreSize * 0.1);
      this.eventStore.splice(0, evictCount);
      this.metrics.eventStoreSize = this.eventStore.length;
      logger.debug('EventBus: evicted old events from store', { evictCount });
    }

    return event;
  }

  private handleFailure(event: StoredEvent, handlerId: string, error: Error): void {
    this.metrics.failures++;
    logger.error('EventBus: handler failed', error, {
      topic: event.topic,
      eventId: event.id,
      handlerId,
    });

    const entry: DeadLetterEntry = {
      event,
      handlerId,
      error: error.message,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.deadLetterQueue.push(entry);
    this.metrics.deadLetterSize = this.deadLetterQueue.length;

    // Evict oldest dead letters if exceeding max size
    if (this.deadLetterQueue.length > this.maxDeadLetterSize) {
      const evictCount = Math.floor(this.maxDeadLetterSize * 0.1);
      this.deadLetterQueue.splice(0, evictCount);
      this.metrics.deadLetterSize = this.deadLetterQueue.length;
      logger.warn('EventBus: dead letter queue overflow, evicted oldest entries', { evictCount });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getEventBus(): EventBus {
  const g = globalThis as unknown as Record<string, EventBus>;
  if (!g.__eventBus__) {
    g.__eventBus__ = new EventBus();
  }
  return g.__eventBus__;
}
