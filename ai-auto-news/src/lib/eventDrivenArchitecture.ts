/**
 * Event-Driven Architecture Engine
 *
 * Comprehensive event sourcing and CQRS with event store,
 * projections, sagas, and replay capabilities.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface DomainEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
  timestamp: number;
}

export interface EventMetadata {
  correlationId: string;
  causationId: string;
  userId?: string;
  tenantId?: string;
  source: string;
  tags: string[];
}

export interface EventSubscription {
  id: string;
  eventTypes: string[];
  handler: (event: DomainEvent) => Promise<void>;
  filter?: (event: DomainEvent) => boolean;
  options: SubscriptionOptions;
}

export interface SubscriptionOptions {
  group?: string;
  startFrom: 'beginning' | 'latest' | number;
  maxRetries: number;
  retryDelayMs: number;
  batchSize: number;
  concurrency: number;
}

export interface Projection {
  id: string;
  name: string;
  eventTypes: string[];
  state: Record<string, unknown>;
  version: number;
  lastProcessedEventId: string | null;
  status: 'active' | 'rebuilding' | 'paused' | 'error';
  handler: (state: Record<string, unknown>, event: DomainEvent) => Record<string, unknown>;
}

export interface Saga {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'compensating' | 'failed';
  steps: SagaStep[];
  currentStep: number;
  context: Record<string, unknown>;
  startedAt: number;
  completedAt: number | null;
}

export interface SagaStep {
  id: string;
  name: string;
  action: (context: Record<string, unknown>) => Promise<Record<string, unknown>>;
  compensation: (context: Record<string, unknown>) => Promise<void>;
  status: 'pending' | 'completed' | 'compensated' | 'failed';
  result: Record<string, unknown> | null;
}

export interface EventStoreStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByAggregate: Record<string, number>;
  subscriptions: number;
  projections: number;
  activeSagas: number;
  avgEventsPerSecond: number;
  storeSizeBytes: number;
}

export interface Snapshot {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: Record<string, unknown>;
  timestamp: number;
}

export class EventDrivenArchitecture {
  private eventStore: DomainEvent[] = [];
  private subscriptions: Map<string, EventSubscription> = new Map();
  private projections: Map<string, Projection> = new Map();
  private sagas: Map<string, Saga> = new Map();
  private snapshots: Map<string, Snapshot> = new Map();
  private aggregateVersions: Map<string, number> = new Map();
  private deadLetterQueue: { event: DomainEvent; error: string; retries: number }[] = [];
  private eventCounter: number = 0;
  private startTime: number = Date.now();

  async publish(params: {
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    payload: Record<string, unknown>;
    metadata?: Partial<EventMetadata>;
  }): Promise<DomainEvent> {
    const currentVersion = this.aggregateVersions.get(params.aggregateId) || 0;
    const newVersion = currentVersion + 1;

    const event: DomainEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      aggregateId: params.aggregateId,
      aggregateType: params.aggregateType,
      eventType: params.eventType,
      version: newVersion,
      payload: params.payload,
      metadata: {
        correlationId: params.metadata?.correlationId || `corr_${Date.now()}`,
        causationId: params.metadata?.causationId || '',
        userId: params.metadata?.userId,
        tenantId: params.metadata?.tenantId,
        source: params.metadata?.source || 'system',
        tags: params.metadata?.tags || [],
      },
      timestamp: Date.now(),
    };

    this.eventStore.push(event);
    this.aggregateVersions.set(params.aggregateId, newVersion);
    this.eventCounter++;

    await this.notifySubscribers(event);
    await this.updateProjections(event);

    logger.debug('Event published', {
      eventId: event.id,
      type: event.eventType,
      aggregateId: event.aggregateId,
    });

    return event;
  }

  subscribe(subscription: EventSubscription): void {
    this.subscriptions.set(subscription.id, subscription);
    logger.info('Event subscription registered', {
      id: subscription.id,
      eventTypes: subscription.eventTypes,
    });
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  registerProjection(projection: Projection): void {
    this.projections.set(projection.id, projection);
    logger.info('Projection registered', { id: projection.id, name: projection.name });
  }

  getProjectionState(projectionId: string): Record<string, unknown> | null {
    const projection = this.projections.get(projectionId);
    return projection ? { ...projection.state } : null;
  }

  async rebuildProjection(projectionId: string): Promise<boolean> {
    const projection = this.projections.get(projectionId);
    if (!projection) return false;

    projection.status = 'rebuilding';
    projection.state = {};
    projection.version = 0;
    projection.lastProcessedEventId = null;

    const relevantEvents = this.eventStore.filter((e) =>
      projection.eventTypes.includes(e.eventType),
    );

    for (const event of relevantEvents) {
      try {
        projection.state = projection.handler(projection.state, event);
        projection.version++;
        projection.lastProcessedEventId = event.id;
      } catch (error) {
        projection.status = 'error';
        logger.error('Projection rebuild failed', error as Error, { projectionId, eventId: event.id });
        return false;
      }
    }

    projection.status = 'active';
    logger.info('Projection rebuilt', { projectionId, eventsProcessed: relevantEvents.length });
    return true;
  }

  async startSaga(params: {
    name: string;
    steps: SagaStep[];
    initialContext?: Record<string, unknown>;
  }): Promise<Saga> {
    const saga: Saga = {
      id: `saga_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: params.name,
      status: 'running',
      steps: params.steps,
      currentStep: 0,
      context: params.initialContext || {},
      startedAt: Date.now(),
      completedAt: null,
    };

    this.sagas.set(saga.id, saga);
    await this.executeSaga(saga);

    return saga;
  }

  private async executeSaga(saga: Saga): Promise<void> {
    while (saga.currentStep < saga.steps.length && saga.status === 'running') {
      const step = saga.steps[saga.currentStep];

      try {
        const result = await step.action(saga.context);
        step.status = 'completed';
        step.result = result;
        saga.context = { ...saga.context, ...result };
        saga.currentStep++;
      } catch (error) {
        step.status = 'failed';
        saga.status = 'compensating';
        logger.warn('Saga step failed, compensating', {
          sagaId: saga.id,
          step: step.name,
          error: (error as Error).message,
        });

        await this.compensateSaga(saga);
        return;
      }
    }

    if (saga.status === 'running') {
      saga.status = 'completed';
      saga.completedAt = Date.now();
    }
  }

  private async compensateSaga(saga: Saga): Promise<void> {
    for (let i = saga.currentStep - 1; i >= 0; i--) {
      const step = saga.steps[i];
      if (step.status === 'completed') {
        try {
          await step.compensation(saga.context);
          step.status = 'compensated';
        } catch (error) {
          logger.error('Saga compensation failed', error as Error, {
            sagaId: saga.id,
            step: step.name,
          });
          saga.status = 'failed';
          return;
        }
      }
    }

    saga.status = 'failed';
    saga.completedAt = Date.now();
  }

  getEventsForAggregate(aggregateId: string, fromVersion?: number): DomainEvent[] {
    let events = this.eventStore.filter((e) => e.aggregateId === aggregateId);
    if (fromVersion !== undefined) {
      events = events.filter((e) => e.version > fromVersion);
    }
    return events.sort((a, b) => a.version - b.version);
  }

  getEventsByType(eventType: string, limit?: number): DomainEvent[] {
    const events = this.eventStore
      .filter((e) => e.eventType === eventType)
      .sort((a, b) => b.timestamp - a.timestamp);
    return limit ? events.slice(0, limit) : events;
  }

  getEventsByCorrelation(correlationId: string): DomainEvent[] {
    return this.eventStore.filter((e) => e.metadata.correlationId === correlationId);
  }

  createSnapshot(aggregateId: string, state: Record<string, unknown>): Snapshot {
    const version = this.aggregateVersions.get(aggregateId) || 0;
    const events = this.getEventsForAggregate(aggregateId);
    const aggregateType = events.length > 0 ? events[0].aggregateType : 'unknown';

    const snapshot: Snapshot = {
      aggregateId,
      aggregateType,
      version,
      state,
      timestamp: Date.now(),
    };

    this.snapshots.set(aggregateId, snapshot);
    return snapshot;
  }

  getSnapshot(aggregateId: string): Snapshot | null {
    return this.snapshots.get(aggregateId) || null;
  }

  async replayEvents(params: {
    fromTimestamp?: number;
    toTimestamp?: number;
    eventTypes?: string[];
    handler: (event: DomainEvent) => Promise<void>;
  }): Promise<number> {
    let events = [...this.eventStore];

    if (params.fromTimestamp) {
      events = events.filter((e) => e.timestamp >= params.fromTimestamp!);
    }
    if (params.toTimestamp) {
      events = events.filter((e) => e.timestamp <= params.toTimestamp!);
    }
    if (params.eventTypes) {
      events = events.filter((e) => params.eventTypes!.includes(e.eventType));
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    let processed = 0;
    for (const event of events) {
      await params.handler(event);
      processed++;
    }

    logger.info('Event replay completed', { eventsProcessed: processed });
    return processed;
  }

  getStats(): EventStoreStats {
    const eventsByType: Record<string, number> = {};
    const eventsByAggregate: Record<string, number> = {};

    for (const event of this.eventStore) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      eventsByAggregate[event.aggregateType] = (eventsByAggregate[event.aggregateType] || 0) + 1;
    }

    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const avgEventsPerSecond = elapsedSeconds > 0 ? this.eventCounter / elapsedSeconds : 0;

    const storeSizeBytes = this.eventStore.reduce(
      (size, e) => size + JSON.stringify(e).length,
      0,
    );

    return {
      totalEvents: this.eventStore.length,
      eventsByType,
      eventsByAggregate,
      subscriptions: this.subscriptions.size,
      projections: this.projections.size,
      activeSagas: Array.from(this.sagas.values()).filter((s) => s.status === 'running').length,
      avgEventsPerSecond: parseFloat(avgEventsPerSecond.toFixed(2)),
      storeSizeBytes,
    };
  }

  getSaga(sagaId: string): Saga | undefined {
    return this.sagas.get(sagaId);
  }

  getDeadLetterQueue(): { event: DomainEvent; error: string; retries: number }[] {
    return [...this.deadLetterQueue];
  }

  clearEventStore(): void {
    this.eventStore = [];
    this.aggregateVersions.clear();
    this.eventCounter = 0;
  }

  private async notifySubscribers(event: DomainEvent): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.eventTypes.includes(event.eventType) && !subscription.eventTypes.includes('*')) {
        continue;
      }

      if (subscription.filter && !subscription.filter(event)) {
        continue;
      }

      let retries = 0;
      const maxRetries = subscription.options.maxRetries;

      while (retries <= maxRetries) {
        try {
          await subscription.handler(event);
          break;
        } catch (error) {
          retries++;
          if (retries > maxRetries) {
            this.deadLetterQueue.push({
              event,
              error: (error as Error).message,
              retries,
            });
            logger.error('Event handler failed after retries', error as Error, {
              subscriptionId: subscription.id,
              eventId: event.id,
            });
          } else {
            await new Promise((resolve) => setTimeout(resolve, subscription.options.retryDelayMs));
          }
        }
      }
    }
  }

  private async updateProjections(event: DomainEvent): Promise<void> {
    for (const projection of this.projections.values()) {
      if (projection.status !== 'active') continue;
      if (!projection.eventTypes.includes(event.eventType)) continue;

      try {
        projection.state = projection.handler(projection.state, event);
        projection.version++;
        projection.lastProcessedEventId = event.id;
      } catch (error) {
        projection.status = 'error';
        logger.error('Projection update failed', error as Error, {
          projectionId: projection.id,
          eventId: event.id,
        });
      }
    }
  }
}

let edaInstance: EventDrivenArchitecture | null = null;

export function getEventDrivenArchitecture(): EventDrivenArchitecture {
  if (!edaInstance) {
    edaInstance = new EventDrivenArchitecture();
  }
  return edaInstance;
}
