import { getLogger } from './logger';
import { getCache } from './cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DomainEvent {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  version: number;
  schemaVersion: number;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
  occurredAt: string;
  recordedAt: string;
}

export interface EventMetadata {
  correlationId: string;
  causationId?: string;
  userId?: string;
  tenantId?: string;
  source: string;
  tags?: string[];
}

export interface Command {
  commandId: string;
  commandType: string;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
  issuedAt: string;
}

export interface CommandResult {
  commandId: string;
  success: boolean;
  events: DomainEvent[];
  error?: string;
  aggregateVersion: number;
}

export interface AggregateRoot<TState = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;
  state: TState;
  uncommittedEvents: DomainEvent[];
}

export interface Snapshot<TState = Record<string, unknown>> {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: TState;
  takenAt: string;
}

export interface EventHandler {
  eventType: string;
  handler: (event: DomainEvent) => Promise<void>;
  filter?: (event: DomainEvent) => boolean;
}

export interface EventSubscription {
  id: string;
  eventTypes: string[];
  aggregateTypes?: string[];
  filter?: (event: DomainEvent) => boolean;
  handler: (event: DomainEvent) => Promise<void>;
  lastProcessedEventId?: string;
  createdAt: string;
}

export interface Projection<TReadModel = Record<string, unknown>> {
  id: string;
  name: string;
  readModel: TReadModel;
  lastEventId: string;
  lastUpdatedAt: string;
  status: 'current' | 'rebuilding' | 'stale';
}

export interface SagaDefinition {
  sagaId: string;
  sagaType: string;
  correlationId: string;
  state: Record<string, unknown>;
  currentStep: number;
  steps: SagaStep[];
  status: 'pending' | 'running' | 'compensating' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  failureReason?: string;
}

export interface SagaStep {
  order: number;
  name: string;
  commandType: string;
  compensatingCommandType?: string;
  completed: boolean;
  compensated: boolean;
  executedAt?: string;
}

export interface DeadLetterEntry {
  id: string;
  originalEventId: string;
  event: DomainEvent;
  subscriptionId: string;
  errorMessage: string;
  attemptCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  nextRetryAt?: string;
  resolved: boolean;
}

export interface EventStoreStats {
  totalEvents: number;
  totalAggregates: number;
  totalSnapshots: number;
  eventsPerType: Record<string, number>;
  oldestEvent?: string;
  newestEvent?: string;
  deadLetterCount: number;
  activeSagas: number;
}

export type CommandValidator = (command: Command, aggregate: AggregateRoot | null) => string | null;
export type EventProjector<TState> = (state: TState, event: DomainEvent) => TState;

// ─── Event Store (in-memory, append-only) ────────────────────────────────────

class InMemoryEventStore {
  private events: DomainEvent[] = [];
  private snapshots: Map<string, Snapshot> = new Map();

  append(event: DomainEvent): void {
    this.events.push(event);
  }

  getEvents(aggregateId: string, fromVersion?: number): DomainEvent[] {
    return this.events
      .filter(e => e.aggregateId === aggregateId && (fromVersion === undefined || e.version > fromVersion))
      .sort((a, b) => a.version - b.version);
  }

  getAllEvents(fromEventId?: string): DomainEvent[] {
    if (!fromEventId) return [...this.events];
    const idx = this.events.findIndex(e => e.eventId === fromEventId);
    return idx >= 0 ? this.events.slice(idx + 1) : [...this.events];
  }

  getEventsByType(eventType: string, limit = 100): DomainEvent[] {
    return this.events.filter(e => e.eventType === eventType).slice(-limit);
  }

  saveSnapshot(snapshot: Snapshot): void {
    this.snapshots.set(`${snapshot.aggregateType}:${snapshot.aggregateId}`, snapshot);
  }

  getSnapshot(aggregateId: string, aggregateType: string): Snapshot | undefined {
    return this.snapshots.get(`${aggregateType}:${aggregateId}`);
  }

  getStats(): Partial<EventStoreStats> {
    const eventsPerType: Record<string, number> = {};
    const aggregates = new Set<string>();
    for (const e of this.events) {
      eventsPerType[e.eventType] = (eventsPerType[e.eventType] ?? 0) + 1;
      aggregates.add(e.aggregateId);
    }
    return {
      totalEvents: this.events.length,
      totalAggregates: aggregates.size,
      totalSnapshots: this.snapshots.size,
      eventsPerType,
      oldestEvent: this.events[0]?.occurredAt,
      newestEvent: this.events[this.events.length - 1]?.occurredAt,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class EventSourcingEngine {
  private readonly logger = getLogger();
  private readonly cache = getCache();
  private readonly store = new InMemoryEventStore();
  private commandValidators: Map<string, CommandValidator[]> = new Map();
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private projectors: Map<string, EventProjector<Record<string, unknown>>> = new Map();
  private projections: Map<string, Projection> = new Map();
  private subscriptions: Map<string, EventSubscription> = new Map();
  private sagas: Map<string, SagaDefinition> = new Map();
  private deadLetterQueue: DeadLetterEntry[] = [];
  private aggregateProjectors: Map<string, EventProjector<Record<string, unknown>>> = new Map();
  private snapshotThreshold = 50;

  // ── Command Handling ──────────────────────────────────────────────────────────

  registerCommandValidator(commandType: string, validator: CommandValidator): void {
    const existing = this.commandValidators.get(commandType) ?? [];
    existing.push(validator);
    this.commandValidators.set(commandType, existing);
  }

  async issueCommand(command: Command): Promise<CommandResult> {
    this.logger.info('EventSourcingEngine: issuing command', { commandId: command.commandId, commandType: command.commandType, aggregateId: command.aggregateId });

    // Load current aggregate state
    const aggregate = await this.loadAggregate(command.aggregateId, command.aggregateType);

    // Validate command
    const validators = this.commandValidators.get(command.commandType) ?? [];
    for (const validate of validators) {
      const error = validate(command, aggregate);
      if (error) {
        this.logger.warn('EventSourcingEngine: command validation failed', { commandId: command.commandId, error });
        return { commandId: command.commandId, success: false, events: [], error, aggregateVersion: aggregate?.version ?? 0 };
      }
    }

    // Dispatch to handler to produce events (placeholder for domain logic hookup)
    const handler = this.eventHandlers.get(command.commandType);
    if (!handler || handler.length === 0) {
      this.logger.warn('EventSourcingEngine: no handler for command', { commandType: command.commandType });
      return { commandId: command.commandId, success: false, events: [], error: `No handler for ${command.commandType}`, aggregateVersion: aggregate?.version ?? 0 };
    }

    // Produce a synthetic domain event from the command.
    // Derive eventType by convention (FooCommand → fooEvent) or fall back to
    // a namespaced form so the resulting type is always non-empty and readable.
    const nextVersion = (aggregate?.version ?? 0) + 1;
    const derivedEventType = command.commandType.endsWith('Command')
      ? command.commandType.replace(/Command$/, 'Event').replace(/^[A-Z]/, c => c.toLowerCase())
      : `${command.aggregateType.toLowerCase()}.${command.commandType.toLowerCase()}.occurred`;
    const event: DomainEvent = {
      eventId: generateId(),
      aggregateId: command.aggregateId,
      aggregateType: command.aggregateType,
      eventType: derivedEventType,
      version: nextVersion,
      schemaVersion: 1,
      payload: command.payload,
      metadata: { ...command.metadata, causationId: command.commandId },
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
    };

    await this.appendEvent(event);
    this.cache.delete(`aggregate:${command.aggregateType}:${command.aggregateId}`);

    return { commandId: command.commandId, success: true, events: [event], aggregateVersion: nextVersion };
  }

  // ── Event Store Operations ────────────────────────────────────────────────────

  async appendEvent(event: DomainEvent): Promise<void> {
    this.store.append(event);
    await this.notifySubscriptions(event);
    await this.updateProjections(event);

    // Auto-snapshot
    if (event.version % this.snapshotThreshold === 0) {
      await this.takeSnapshot(event.aggregateId, event.aggregateType);
    }
  }

  async appendEvents(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.appendEvent(event);
    }
  }

  getEvents(aggregateId: string, fromVersion?: number): DomainEvent[] {
    return this.store.getEvents(aggregateId, fromVersion);
  }

  getEventsByType(eventType: string, limit = 100): DomainEvent[] {
    return this.store.getEventsByType(eventType, limit);
  }

  // ── Aggregate Reconstruction ──────────────────────────────────────────────────

  registerAggregateProjector<TState extends Record<string, unknown>>(
    aggregateType: string,
    projector: EventProjector<TState>,
    initialState: TState,
  ): void {
    this.aggregateProjectors.set(aggregateType, projector as EventProjector<Record<string, unknown>>);
    this.cache.set(`aggregate-initial:${aggregateType}`, initialState, 86400);
  }

  async loadAggregate(aggregateId: string, aggregateType: string): Promise<AggregateRoot | null> {
    const cacheKey = `aggregate:${aggregateType}:${aggregateId}`;
    const cached = this.cache.get<AggregateRoot>(cacheKey);
    if (cached) return cached;

    const projector = this.aggregateProjectors.get(aggregateType);
    const snapshot = this.store.getSnapshot(aggregateId, aggregateType);

    let state: Record<string, unknown> = (this.cache.get(`aggregate-initial:${aggregateType}`) as Record<string, unknown>) ?? {};
    let fromVersion: number | undefined;

    if (snapshot) {
      state = snapshot.state;
      fromVersion = snapshot.version;
    }

    const events = this.store.getEvents(aggregateId, fromVersion);
    if (events.length === 0 && !snapshot) return null;

    if (projector) {
      for (const event of events) {
        state = projector(state, event);
      }
    }

    const lastEvent = events[events.length - 1] ?? snapshot;
    const version = lastEvent ? ('version' in lastEvent ? lastEvent.version : 0) : 0;

    const aggregate: AggregateRoot = {
      id: aggregateId,
      type: aggregateType,
      version,
      state,
      uncommittedEvents: [],
    };

    this.cache.set(cacheKey, aggregate, 60);
    return aggregate;
  }

  // ── Snapshot Management ───────────────────────────────────────────────────────

  async takeSnapshot(aggregateId: string, aggregateType: string): Promise<Snapshot | null> {
    const aggregate = await this.loadAggregate(aggregateId, aggregateType);
    if (!aggregate) return null;

    const snapshot: Snapshot = {
      aggregateId,
      aggregateType,
      version: aggregate.version,
      state: aggregate.state,
      takenAt: new Date().toISOString(),
    };

    this.store.saveSnapshot(snapshot);
    this.logger.info('EventSourcingEngine: snapshot taken', { aggregateId, aggregateType, version: snapshot.version });
    return snapshot;
  }

  setSnapshotThreshold(n: number): void {
    this.snapshotThreshold = n;
  }

  // ── Event Replay ──────────────────────────────────────────────────────────────

  async replayEvents(aggregateId: string, aggregateType: string, toVersion?: number): Promise<AggregateRoot> {
    const projector = this.aggregateProjectors.get(aggregateType);
    const initialState: Record<string, unknown> = (this.cache.get(`aggregate-initial:${aggregateType}`) as Record<string, unknown>) ?? {};

    let events = this.store.getEvents(aggregateId);
    if (toVersion !== undefined) events = events.filter(e => e.version <= toVersion);

    let state = { ...initialState };
    if (projector) {
      for (const event of events) state = projector(state, event);
    }

    const lastEvent = events[events.length - 1];
    return { id: aggregateId, type: aggregateType, version: lastEvent?.version ?? 0, state, uncommittedEvents: [] };
  }

  // ── Projections ───────────────────────────────────────────────────────────────

  registerProjection<TReadModel extends Record<string, unknown>>(
    projectionId: string,
    name: string,
    projector: EventProjector<TReadModel>,
    initialReadModel: TReadModel,
  ): void {
    this.projectors.set(projectionId, projector as EventProjector<Record<string, unknown>>);
    const projection: Projection<TReadModel> = {
      id: projectionId,
      name,
      readModel: initialReadModel,
      lastEventId: '',
      lastUpdatedAt: new Date().toISOString(),
      status: 'current',
    };
    this.projections.set(projectionId, projection as Projection);
  }

  getProjection<TReadModel = Record<string, unknown>>(projectionId: string): Projection<TReadModel> | undefined {
    return this.projections.get(projectionId) as Projection<TReadModel> | undefined;
  }

  async rebuildProjection(projectionId: string): Promise<void> {
    const projection = this.projections.get(projectionId);
    const projector = this.projectors.get(projectionId);
    if (!projection || !projector) throw new Error(`Projection ${projectionId} not found`);

    projection.status = 'rebuilding';
    this.logger.info('EventSourcingEngine: rebuilding projection', { projectionId });

    const allEvents = this.store.getAllEvents();
    let readModel: Record<string, unknown> = {};
    for (const event of allEvents) {
      readModel = projector(readModel, event);
    }

    projection.readModel = readModel;
    projection.lastEventId = allEvents[allEvents.length - 1]?.eventId ?? '';
    projection.lastUpdatedAt = new Date().toISOString();
    projection.status = 'current';
    this.logger.info('EventSourcingEngine: projection rebuilt', { projectionId, eventsProcessed: allEvents.length });
  }

  private async updateProjections(event: DomainEvent): Promise<void> {
    for (const [id, projector] of this.projectors.entries()) {
      const projection = this.projections.get(id);
      if (!projection || projection.status === 'rebuilding') continue;
      try {
        projection.readModel = projector(projection.readModel, event);
        projection.lastEventId = event.eventId;
        projection.lastUpdatedAt = new Date().toISOString();
      } catch (err) {
        this.logger.warn('EventSourcingEngine: projection update failed', { projectionId: id, eventId: event.eventId, error: (err as Error).message });
        projection.status = 'stale';
      }
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────────

  subscribe(sub: Omit<EventSubscription, 'id' | 'createdAt'>): EventSubscription {
    const subscription: EventSubscription = { ...sub, id: generateId(), createdAt: new Date().toISOString() };
    this.subscriptions.set(subscription.id, subscription);
    this.logger.info('EventSourcingEngine: subscription registered', { id: subscription.id, eventTypes: subscription.eventTypes });
    return subscription;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  private async notifySubscriptions(event: DomainEvent): Promise<void> {
    for (const sub of this.subscriptions.values()) {
      const typeMatch = sub.eventTypes.includes('*') || sub.eventTypes.includes(event.eventType);
      const aggregateMatch = !sub.aggregateTypes || sub.aggregateTypes.includes(event.aggregateType);
      const filterMatch = !sub.filter || sub.filter(event);
      if (!typeMatch || !aggregateMatch || !filterMatch) continue;

      try {
        await sub.handler(event);
        sub.lastProcessedEventId = event.eventId;
      } catch (err) {
        await this.sendToDeadLetter(event, sub.id, (err as Error).message);
      }
    }
  }

  // ── Dead Letter Queue ─────────────────────────────────────────────────────────

  private async sendToDeadLetter(event: DomainEvent, subscriptionId: string, errorMessage: string): Promise<void> {
    const existing = this.deadLetterQueue.find(e => e.originalEventId === event.eventId && e.subscriptionId === subscriptionId);
    const now = new Date().toISOString();
    if (existing) {
      existing.attemptCount++;
      existing.lastFailedAt = now;
      existing.nextRetryAt = new Date(Date.now() + Math.min(3600_000, 30_000 * Math.pow(2, existing.attemptCount))).toISOString();
    } else {
      this.deadLetterQueue.push({
        id: generateId(),
        originalEventId: event.eventId,
        event,
        subscriptionId,
        errorMessage,
        attemptCount: 1,
        firstFailedAt: now,
        lastFailedAt: now,
        nextRetryAt: new Date(Date.now() + 30_000).toISOString(),
        resolved: false,
      });
    }
    this.logger.warn('EventSourcingEngine: event sent to DLQ', { eventId: event.eventId, subscriptionId, errorMessage });
  }

  getDeadLetterQueue(resolvedOnly = false): DeadLetterEntry[] {
    return this.deadLetterQueue.filter(e => resolvedOnly ? e.resolved : !e.resolved);
  }

  async retryDeadLetterEntry(dlqId: string): Promise<boolean> {
    const entry = this.deadLetterQueue.find(e => e.id === dlqId);
    if (!entry || entry.resolved) return false;
    const sub = this.subscriptions.get(entry.subscriptionId);
    if (!sub) { entry.resolved = true; return false; }
    try {
      await sub.handler(entry.event);
      entry.resolved = true;
      this.logger.info('EventSourcingEngine: DLQ entry retried successfully', { dlqId });
      return true;
    } catch (err) {
      entry.attemptCount++;
      entry.lastFailedAt = new Date().toISOString();
      this.logger.warn('EventSourcingEngine: DLQ retry failed', { dlqId, error: (err as Error).message });
      return false;
    }
  }

  // ── Saga Coordination ─────────────────────────────────────────────────────────

  startSaga(sagaType: string, correlationId: string, steps: Omit<SagaStep, 'completed' | 'compensated'>[]): SagaDefinition {
    const saga: SagaDefinition = {
      sagaId: generateId(),
      sagaType,
      correlationId,
      state: {},
      currentStep: 0,
      steps: steps.map(s => ({ ...s, completed: false, compensated: false })),
      status: 'pending',
      startedAt: new Date().toISOString(),
    };
    this.sagas.set(saga.sagaId, saga);
    this.logger.info('EventSourcingEngine: saga started', { sagaId: saga.sagaId, sagaType, steps: steps.length });
    return saga;
  }

  async advanceSaga(sagaId: string, stepResult: { success: boolean; state?: Record<string, unknown> }): Promise<SagaDefinition> {
    const saga = this.sagas.get(sagaId);
    if (!saga) throw new Error(`Saga ${sagaId} not found`);

    const currentStep = saga.steps[saga.currentStep];
    if (!currentStep) throw new Error(`No step at index ${saga.currentStep}`);

    if (stepResult.success) {
      currentStep.completed = true;
      currentStep.executedAt = new Date().toISOString();
      if (stepResult.state) Object.assign(saga.state, stepResult.state);
      saga.currentStep++;
      if (saga.currentStep >= saga.steps.length) {
        saga.status = 'completed';
        saga.completedAt = new Date().toISOString();
        this.logger.info('EventSourcingEngine: saga completed', { sagaId });
      } else {
        saga.status = 'running';
      }
    } else {
      saga.status = 'compensating';
      saga.failedAt = new Date().toISOString();
      saga.failureReason = `Step ${currentStep.name} failed`;
      await this.compensateSaga(saga);
    }

    return saga;
  }

  private async compensateSaga(saga: SagaDefinition): Promise<void> {
    for (let i = saga.currentStep - 1; i >= 0; i--) {
      const step = saga.steps[i];
      if (step.completed && !step.compensated && step.compensatingCommandType) {
        step.compensated = true;
        this.logger.info('EventSourcingEngine: compensating saga step', { sagaId: saga.sagaId, step: step.name });
      }
    }
    saga.status = 'failed';
    this.logger.warn('EventSourcingEngine: saga failed after compensation', { sagaId: saga.sagaId });
  }

  getSaga(sagaId: string): SagaDefinition | undefined {
    return this.sagas.get(sagaId);
  }

  getActiveSagas(): SagaDefinition[] {
    return [...this.sagas.values()].filter(s => s.status === 'running' || s.status === 'pending');
  }

  // ── Event Schema Versioning ───────────────────────────────────────────────────

  private schemaUpgraders: Map<string, Map<number, (payload: Record<string, unknown>) => Record<string, unknown>>> = new Map();

  registerSchemaUpgrader(
    eventType: string,
    fromSchemaVersion: number,
    upgrader: (payload: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    if (!this.schemaUpgraders.has(eventType)) this.schemaUpgraders.set(eventType, new Map());
    this.schemaUpgraders.get(eventType)!.set(fromSchemaVersion, upgrader);
  }

  upgradeEventSchema(event: DomainEvent, targetSchemaVersion: number): DomainEvent {
    const upgraders = this.schemaUpgraders.get(event.eventType);
    if (!upgraders) return event;

    let payload = { ...event.payload };
    let schemaVersion = event.schemaVersion;
    while (schemaVersion < targetSchemaVersion) {
      const upgrader = upgraders.get(schemaVersion);
      if (!upgrader) break;
      payload = upgrader(payload);
      schemaVersion++;
    }
    return { ...event, payload, schemaVersion };
  }

  // ── Consistency & Stats ───────────────────────────────────────────────────────

  getStats(): EventStoreStats {
    const base = this.store.getStats();
    return {
      totalEvents: base.totalEvents ?? 0,
      totalAggregates: base.totalAggregates ?? 0,
      totalSnapshots: base.totalSnapshots ?? 0,
      eventsPerType: base.eventsPerType ?? {},
      oldestEvent: base.oldestEvent,
      newestEvent: base.newestEvent,
      deadLetterCount: this.deadLetterQueue.filter(e => !e.resolved).length,
      activeSagas: this.getActiveSagas().length,
    };
  }

  async verifyConsistency(aggregateId: string, aggregateType: string): Promise<{ consistent: boolean; issues: string[] }> {
    const events = this.store.getEvents(aggregateId);
    const issues: string[] = [];

    // Check version sequence
    for (let i = 0; i < events.length; i++) {
      if (events[i].version !== i + 1) {
        issues.push(`Version gap: expected ${i + 1}, got ${events[i].version} at index ${i}`);
      }
    }

    // Check no duplicate event IDs
    const ids = events.map(e => e.eventId);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      issues.push(`Duplicate event IDs detected: ${ids.length - unique.size} duplicates`);
    }

    return { consistent: issues.length === 0, issues };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getEventSourcingEngine(): EventSourcingEngine {
  if (!globalThis.__eventSourcingEngine__) {
    globalThis.__eventSourcingEngine__ = new EventSourcingEngine();
  }
  return globalThis.__eventSourcingEngine__ as EventSourcingEngine;
}
