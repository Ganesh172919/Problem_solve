/**
 * CQRS (Command Query Responsibility Segregation) Engine
 *
 * - Command/Query buses with handler registration and dispatch
 * - Middleware pipeline (logging, validation, authorization, metrics)
 * - Event sourcing: aggregate roots, append-only event store, snapshots
 * - Saga/Process manager for long-running transactions
 * - Command retry with exponential backoff and deduplication
 * - Projection system for read models
 * - Dead letter queue for failed commands
 * - Aggregate versioning with optimistic concurrency
 */

import { getLogger } from './logger';

const logger = getLogger();

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CqrsCommand {
  commandId: string;
  commandType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  metadata: CommandMetadata;
  issuedAt: string;
}

export interface CommandMetadata {
  correlationId: string;
  causationId?: string;
  userId?: string;
  tenantId?: string;
  idempotencyKey?: string;
  retryCount?: number;
  maxRetries?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

export interface CommandResult {
  commandId: string;
  success: boolean;
  events: DomainEvent[];
  aggregateVersion: number;
  error?: string;
  retriable?: boolean;
}

export interface CqrsQuery {
  queryId: string;
  queryType: string;
  params: Record<string, unknown>;
  metadata: { correlationId: string; userId?: string; tenantId?: string; cacheTtl?: number; consistency?: 'strong' | 'eventual' };
}

export interface QueryResult<T = unknown> {
  queryId: string;
  data: T;
  metadata: { executionMs: number; fromCache: boolean; staleAt?: string };
}

export interface DomainEvent {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: { correlationId: string; causationId?: string; userId?: string; tenantId?: string };
  occurredAt: string;
}

export interface AggregateSnapshot {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: Record<string, unknown>;
  takenAt: string;
}

export interface DeadLetterEntry {
  id: string;
  command: CqrsCommand;
  error: string;
  failedAt: string;
  retryCount: number;
  resolved: boolean;
}

export interface MiddlewareContext {
  command?: CqrsCommand;
  query?: CqrsQuery;
  result?: CommandResult | QueryResult;
  metadata: Record<string, unknown>;
  startedAt: number;
  userId?: string;
  tenantId?: string;
  aborted: boolean;
  abort: (reason: string) => void;
}

export interface SagaStep {
  name: string;
  execute: (ctx: SagaContext) => Promise<void>;
  compensate: (ctx: SagaContext) => Promise<void>;
  retries?: number;
  timeout?: number;
}

export interface SagaDefinition {
  sagaId: string;
  name: string;
  steps: SagaStep[];
  timeout: number;
  onComplete?: (ctx: SagaContext) => Promise<void>;
  onFailed?: (ctx: SagaContext, error: Error) => Promise<void>;
}

export interface SagaContext {
  sagaId: string;
  instanceId: string;
  data: Record<string, unknown>;
  completedSteps: string[];
  currentStep: string;
  status: 'running' | 'compensating' | 'completed' | 'failed';
  startedAt: string;
  error?: string;
}

export interface ProjectionDefinition {
  name: string;
  eventTypes: string[];
  handler: (event: DomainEvent, state: Record<string, unknown>) => Record<string, unknown>;
  initialState: Record<string, unknown>;
}

export interface CqrsEngineConfig {
  snapshotInterval: number;
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  deduplicationWindowMs: number;
  deadLetterMaxSize: number;
  queryCache: boolean;
  queryCacheTtlMs: number;
}

export type CommandHandler = (cmd: CqrsCommand, ctx: MiddlewareContext) => Promise<CommandResult>;
export type QueryHandler<T = unknown> = (query: CqrsQuery, ctx: MiddlewareContext) => Promise<T>;
export type Middleware = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
export type EventHandler = (event: DomainEvent) => Promise<void>;
export type EventApplier = (state: Record<string, unknown>, event: DomainEvent) => Record<string, unknown>;

// ─── Concurrency Error ──────────────────────────────────────────────────────

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

// ─── Event Store ────────────────────────────────────────────────────────────

export class EventStore {
  private events: DomainEvent[] = [];
  private snapshots = new Map<string, AggregateSnapshot>();
  private subscribers = new Map<string, EventHandler[]>();
  private globalSubscribers: EventHandler[] = [];

  append(events: DomainEvent[]): void {
    for (const e of events) this.events.push(Object.freeze({ ...e }) as DomainEvent);
    logger.debug('Events appended', { count: events.length });
  }

  getEventsForAggregate(aggregateId: string, afterVersion = 0): DomainEvent[] {
    return this.events.filter((e) => e.aggregateId === aggregateId && e.version > afterVersion);
  }

  getEventsByType(eventType: string, since?: string): DomainEvent[] {
    return this.events.filter((e) => e.eventType === eventType && (!since || e.occurredAt >= since));
  }

  getAllEvents(afterPosition = 0): DomainEvent[] {
    return this.events.slice(afterPosition);
  }

  getEventCount(): number { return this.events.length; }

  saveSnapshot(snapshot: AggregateSnapshot): void {
    this.snapshots.set(snapshot.aggregateId, Object.freeze({ ...snapshot }) as AggregateSnapshot);
    logger.debug('Snapshot saved', { aggregateId: snapshot.aggregateId, version: snapshot.version });
  }

  getSnapshot(aggregateId: string): AggregateSnapshot | undefined {
    return this.snapshots.get(aggregateId);
  }

  subscribe(eventType: string, handler: EventHandler): () => void {
    const handlers = this.subscribers.get(eventType) ?? [];
    handlers.push(handler);
    this.subscribers.set(eventType, handlers);
    return () => {
      const cur = this.subscribers.get(eventType) ?? [];
      this.subscribers.set(eventType, cur.filter((h) => h !== handler));
    };
  }

  subscribeAll(handler: EventHandler): () => void {
    this.globalSubscribers.push(handler);
    return () => { this.globalSubscribers = this.globalSubscribers.filter((h) => h !== handler); };
  }

  async publish(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = [...(this.subscribers.get(event.eventType) ?? []), ...this.globalSubscribers];
      for (const handler of handlers) {
        try { await handler(event); }
        catch (err) {
          logger.error('Event handler failed', err instanceof Error ? err : new Error(String(err)),
            { eventType: event.eventType, eventId: event.eventId });
        }
      }
    }
  }
}

// ─── Aggregate Repository ───────────────────────────────────────────────────

export class AggregateRepository {
  private appliers = new Map<string, Map<string, EventApplier>>();
  private versionCache = new Map<string, number>();

  constructor(private eventStore: EventStore, private snapshotInterval: number) {}

  registerApplier(aggregateType: string, eventType: string, applier: EventApplier): void {
    if (!this.appliers.has(aggregateType)) this.appliers.set(aggregateType, new Map());
    this.appliers.get(aggregateType)!.set(eventType, applier);
  }

  load(aggregateId: string, aggregateType: string): { state: Record<string, unknown>; version: number } {
    const snapshot = this.eventStore.getSnapshot(aggregateId);
    const afterVersion = snapshot?.version ?? 0;
    const events = this.eventStore.getEventsForAggregate(aggregateId, afterVersion);
    const typeAppliers = this.appliers.get(aggregateType) ?? new Map();

    let state: Record<string, unknown> = snapshot?.state ? { ...snapshot.state } : {};
    let version = afterVersion;
    for (const event of events) {
      const applier = typeAppliers.get(event.eventType);
      if (applier) state = applier(state, event);
      version = event.version;
    }
    this.versionCache.set(aggregateId, version);
    return { state, version };
  }

  save(aggregateId: string, aggregateType: string, events: DomainEvent[], expectedVersion: number): void {
    const currentVersion = this.versionCache.get(aggregateId) ?? 0;
    if (currentVersion !== expectedVersion) {
      throw new ConcurrencyError(
        `Concurrency conflict on ${aggregateId}: expected v${expectedVersion}, actual v${currentVersion}`
      );
    }

    this.eventStore.append(events);
    const newVersion = events.length > 0 ? events[events.length - 1].version : expectedVersion;
    this.versionCache.set(aggregateId, newVersion);

    if (newVersion > 0 && newVersion % this.snapshotInterval === 0) {
      const { state } = this.load(aggregateId, aggregateType);
      this.eventStore.saveSnapshot({
        aggregateId, aggregateType, version: newVersion, state, takenAt: new Date().toISOString(),
      });
    }
  }

  getCurrentVersion(aggregateId: string): number {
    return this.versionCache.get(aggregateId) ?? 0;
  }
}

// ─── Middleware Helpers ──────────────────────────────────────────────────────

function buildChain(mws: Middleware[], ctx: MiddlewareContext, final: () => Promise<void>): () => Promise<void> {
  let idx = -1;
  const run = (i: number): Promise<void> => {
    if (i <= idx) return Promise.reject(new Error('next() called multiple times'));
    idx = i;
    return i < mws.length ? mws[i](ctx, () => run(i + 1)) : final();
  };
  return () => run(0);
}

function makeCtx(partial: Partial<MiddlewareContext>): MiddlewareContext {
  const ctx: MiddlewareContext = {
    metadata: {}, startedAt: Date.now(), aborted: false,
    abort(reason: string) { this.aborted = true; this.metadata['abortReason'] = reason; },
    ...partial,
  };
  return ctx;
}

export function loggingMiddleware(): Middleware {
  return async (ctx, next) => {
    const type = ctx.command?.commandType ?? ctx.query?.queryType ?? 'unknown';
    const id = ctx.command?.commandId ?? ctx.query?.queryId ?? 'unknown';
    logger.info('CQRS request start', { type, id });
    try {
      await next();
      logger.info('CQRS request done', { type, id, durationMs: Date.now() - ctx.startedAt });
    } catch (err) {
      logger.error('CQRS request failed', err instanceof Error ? err : new Error(String(err)),
        { type, id, durationMs: Date.now() - ctx.startedAt });
      throw err;
    }
  };
}

export function validationMiddleware(
  validators: Map<string, (payload: Record<string, unknown>) => string[]>
): Middleware {
  return async (ctx, next) => {
    if (!ctx.command) return next();
    const v = validators.get(ctx.command.commandType);
    if (v) {
      const errors = v(ctx.command.payload);
      if (errors.length > 0) { ctx.abort(`Validation failed: ${errors.join('; ')}`); return; }
    }
    await next();
  };
}

export function authorizationMiddleware(
  authorizer: (userId: string | undefined, action: string) => boolean
): Middleware {
  return async (ctx, next) => {
    const action = ctx.command?.commandType ?? ctx.query?.queryType ?? '';
    const userId = ctx.command?.metadata.userId ?? ctx.query?.metadata.userId;
    if (!authorizer(userId, action)) {
      ctx.abort(`Unauthorized: ${userId ?? 'anonymous'} cannot perform ${action}`);
      return;
    }
    await next();
  };
}

export function metricsMiddleware(
  recorder: (type: string, durationMs: number, success: boolean) => void
): Middleware {
  return async (ctx, next) => {
    const type = ctx.command?.commandType ?? ctx.query?.queryType ?? 'unknown';
    try { await next(); recorder(type, Date.now() - ctx.startedAt, true); }
    catch (err) { recorder(type, Date.now() - ctx.startedAt, false); throw err; }
  };
}

// ─── Dead Letter Queue ──────────────────────────────────────────────────────

export class DeadLetterQueue {
  private entries: DeadLetterEntry[] = [];

  constructor(private maxSize: number) {}

  enqueue(command: CqrsCommand, error: string, retryCount: number): void {
    if (this.entries.length >= this.maxSize) {
      const resolved = this.entries.findIndex((e) => e.resolved);
      if (resolved >= 0) this.entries.splice(resolved, 1);
      else { this.entries.shift(); logger.warn('DLQ overflow, oldest entry dropped'); }
    }
    this.entries.push({
      id: `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      command, error, failedAt: new Date().toISOString(), retryCount, resolved: false,
    });
    logger.warn('Command sent to DLQ', { commandId: command.commandId, commandType: command.commandType, error });
  }

  getUnresolved(): DeadLetterEntry[] { return this.entries.filter((e) => !e.resolved); }

  resolve(id: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) { entry.resolved = true; return true; }
    return false;
  }

  getById(id: string): DeadLetterEntry | undefined { return this.entries.find((e) => e.id === id); }
  size(): number { return this.entries.filter((e) => !e.resolved).length; }
}

// ─── Projection Manager ────────────────────────────────────────────────────

export class ProjectionManager {
  private projections = new Map<string, ProjectionDefinition>();
  private states = new Map<string, Record<string, unknown>>();
  private positions = new Map<string, number>();

  register(projection: ProjectionDefinition): void {
    this.projections.set(projection.name, projection);
    this.states.set(projection.name, { ...projection.initialState });
    this.positions.set(projection.name, 0);
    logger.info('Projection registered', { name: projection.name, eventTypes: projection.eventTypes });
  }

  async apply(event: DomainEvent): Promise<void> {
    for (const [name, proj] of this.projections) {
      if (!proj.eventTypes.includes(event.eventType) && !proj.eventTypes.includes('*')) continue;
      try {
        const current = this.states.get(name) ?? { ...proj.initialState };
        this.states.set(name, proj.handler(event, current));
        this.positions.set(name, (this.positions.get(name) ?? 0) + 1);
      } catch (err) {
        logger.error('Projection apply failed', err instanceof Error ? err : new Error(String(err)),
          { projection: name, eventType: event.eventType });
      }
    }
  }

  getState<T = Record<string, unknown>>(name: string): T | undefined {
    return this.states.get(name) as T | undefined;
  }

  getPosition(name: string): number { return this.positions.get(name) ?? 0; }

  async rebuild(name: string, eventStore: EventStore): Promise<void> {
    const proj = this.projections.get(name);
    if (!proj) throw new Error(`Projection ${name} not found`);

    this.states.set(name, { ...proj.initialState });
    this.positions.set(name, 0);

    let processed = 0;
    for (const event of eventStore.getAllEvents()) {
      if (proj.eventTypes.includes(event.eventType) || proj.eventTypes.includes('*')) {
        this.states.set(name, proj.handler(event, this.states.get(name)!));
        processed++;
      }
    }
    this.positions.set(name, processed);
    logger.info('Projection rebuilt', { projection: name, eventsProcessed: processed });
  }

  listProjections(): string[] { return Array.from(this.projections.keys()); }
}

// ─── Saga Manager ───────────────────────────────────────────────────────────

export class SagaManager {
  private definitions = new Map<string, SagaDefinition>();
  private instances = new Map<string, SagaContext>();

  register(def: SagaDefinition): void {
    this.definitions.set(def.sagaId, def);
    logger.info('Saga registered', { sagaId: def.sagaId, name: def.name });
  }

  async start(sagaId: string, initialData: Record<string, unknown> = {}): Promise<SagaContext> {
    const def = this.definitions.get(sagaId);
    if (!def) throw new Error(`Saga ${sagaId} not found`);

    const ctx: SagaContext = {
      sagaId, instanceId: `saga_${sagaId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      data: { ...initialData }, completedSteps: [], currentStep: '',
      status: 'running', startedAt: new Date().toISOString(),
    };
    this.instances.set(ctx.instanceId, ctx);
    logger.info('Saga started', { sagaId, instanceId: ctx.instanceId });

    try {
      for (const step of def.steps) {
        if (ctx.status !== 'running') break;
        ctx.currentStep = step.name;
        await this.executeStep(step, ctx);
        ctx.completedSteps.push(step.name);
      }
      ctx.status = 'completed';
      if (def.onComplete) await def.onComplete(ctx);
      logger.info('Saga completed', { sagaId, instanceId: ctx.instanceId });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ctx.error = error.message;
      logger.error('Saga failed, compensating', error, { sagaId, step: ctx.currentStep });
      await this.compensate(def, ctx);
      if (def.onFailed) await def.onFailed(ctx, error);
    }
    return ctx;
  }

  private async executeStep(step: SagaStep, ctx: SagaContext): Promise<void> {
    const maxRetries = step.retries ?? 0;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (step.timeout) {
          await Promise.race([
            step.execute(ctx),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error(`Step ${step.name} timed out`)), step.timeout)),
          ]);
        } else {
          await step.execute(ctx);
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30000)));
          logger.warn('Saga step retry', { step: step.name, attempt: attempt + 1 });
        }
      }
    }
    throw lastError;
  }

  private async compensate(def: SagaDefinition, ctx: SagaContext): Promise<void> {
    ctx.status = 'compensating';
    for (const stepName of [...ctx.completedSteps].reverse()) {
      const step = def.steps.find((s) => s.name === stepName);
      if (!step) continue;
      try {
        ctx.currentStep = stepName;
        await step.compensate(ctx);
        logger.debug('Saga step compensated', { sagaId: ctx.sagaId, step: stepName });
      } catch (err) {
        logger.error('Compensation failed', err instanceof Error ? err : new Error(String(err)),
          { sagaId: ctx.sagaId, step: stepName });
      }
    }
    ctx.status = 'failed';
  }

  getInstance(id: string): SagaContext | undefined { return this.instances.get(id); }

  getActiveInstances(): SagaContext[] {
    return Array.from(this.instances.values()).filter((i) => i.status === 'running' || i.status === 'compensating');
  }
}

// ─── Command Bus ────────────────────────────────────────────────────────────

export class CommandBus {
  private handlers = new Map<string, CommandHandler>();
  private middlewares: Middleware[] = [];
  private processedKeys = new Map<string, { result: CommandResult; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private config: CqrsEngineConfig, private dlq: DeadLetterQueue) {
    this.cleanupTimer = setInterval(() => this.pruneDedup(), config.deduplicationWindowMs);
  }

  register(commandType: string, handler: CommandHandler): void {
    if (this.handlers.has(commandType)) logger.warn('Overwriting command handler', { commandType });
    this.handlers.set(commandType, handler);
  }

  use(mw: Middleware): void { this.middlewares.push(mw); }

  async dispatch(command: CqrsCommand): Promise<CommandResult> {
    // Deduplication check
    const idemKey = command.metadata.idempotencyKey;
    if (idemKey) {
      const cached = this.processedKeys.get(idemKey);
      if (cached && cached.expiresAt > Date.now()) {
        logger.debug('Command deduplicated', { commandId: command.commandId, idempotencyKey: idemKey });
        return cached.result;
      }
    }

    const handler = this.handlers.get(command.commandType);
    if (!handler) {
      return { commandId: command.commandId, success: false, events: [], aggregateVersion: 0,
        error: `No handler for command: ${command.commandType}` };
    }

    const maxRetries = command.metadata.maxRetries ?? this.config.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.exec(command, handler, attempt);
        if (result.success && idemKey) {
          this.processedKeys.set(idemKey, { result, expiresAt: Date.now() + this.config.deduplicationWindowMs });
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= maxRetries) break;
        const delay = Math.min(
          this.config.baseRetryDelayMs * 2 ** attempt + Math.random() * 100,
          this.config.maxRetryDelayMs
        );
        logger.warn('Command retry', { commandId: command.commandId, attempt: attempt + 1, delayMs: Math.round(delay) });
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.dlq.enqueue(command, lastError?.message ?? 'Unknown error', maxRetries);
    return { commandId: command.commandId, success: false, events: [], aggregateVersion: 0,
      error: lastError?.message, retriable: false };
  }

  private async exec(command: CqrsCommand, handler: CommandHandler, attempt: number): Promise<CommandResult> {
    const ctx = makeCtx({
      command: { ...command, metadata: { ...command.metadata, retryCount: attempt } },
      userId: command.metadata.userId,
      tenantId: command.metadata.tenantId,
    });

    let result: CommandResult | undefined;
    const chain = buildChain(this.middlewares, ctx, async () => {
      if (ctx.aborted) return;
      result = await handler(ctx.command!, ctx);
      ctx.result = result;
    });
    await chain();

    if (ctx.aborted) {
      return { commandId: command.commandId, success: false, events: [], aggregateVersion: 0,
        error: ctx.metadata['abortReason'] as string };
    }
    return result!;
  }

  private pruneDedup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.processedKeys) {
      if (entry.expiresAt <= now) { this.processedKeys.delete(key); cleaned++; }
    }
    if (cleaned > 0) logger.debug('Dedup cache pruned', { removed: cleaned });
  }

  destroy(): void { if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; } }
  getRegisteredCommands(): string[] { return Array.from(this.handlers.keys()); }
}

// ─── Query Bus ──────────────────────────────────────────────────────────────

export class QueryBus {
  private handlers = new Map<string, QueryHandler>();
  private middlewares: Middleware[] = [];
  private cache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(private config: CqrsEngineConfig) {}

  register<T = unknown>(queryType: string, handler: QueryHandler<T>): void {
    this.handlers.set(queryType, handler as QueryHandler);
  }

  use(mw: Middleware): void { this.middlewares.push(mw); }

  async dispatch<T = unknown>(query: CqrsQuery): Promise<QueryResult<T>> {
    const handler = this.handlers.get(query.queryType);
    if (!handler) throw new Error(`No handler for query: ${query.queryType}`);

    // Cache check
    if (this.config.queryCache && query.metadata.consistency !== 'strong') {
      const key = `${query.queryType}:${JSON.stringify(query.params)}`;
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return { queryId: query.queryId, data: cached.data as T,
          metadata: { executionMs: 0, fromCache: true, staleAt: new Date(cached.expiresAt).toISOString() } };
      }
    }

    const ctx = makeCtx({ query, userId: query.metadata.userId, tenantId: query.metadata.tenantId });
    let data: unknown;

    const chain = buildChain(this.middlewares, ctx, async () => {
      if (ctx.aborted) return;
      data = await handler(query, ctx);
    });
    await chain();

    if (ctx.aborted) throw new Error(ctx.metadata['abortReason'] as string);

    const executionMs = Date.now() - ctx.startedAt;
    if (this.config.queryCache) {
      const ttl = query.metadata.cacheTtl ?? this.config.queryCacheTtlMs;
      this.cache.set(`${query.queryType}:${JSON.stringify(query.params)}`, { data, expiresAt: Date.now() + ttl });
    }

    return { queryId: query.queryId, data: data as T, metadata: { executionMs, fromCache: false } };
  }

  invalidateCache(queryType?: string): void {
    if (queryType) {
      for (const key of this.cache.keys()) if (key.startsWith(`${queryType}:`)) this.cache.delete(key);
    } else this.cache.clear();
  }

  getRegisteredQueries(): string[] { return Array.from(this.handlers.keys()); }
}

// ─── CQRS Engine (Façade) ───────────────────────────────────────────────────

const DEFAULT_CONFIG: CqrsEngineConfig = {
  snapshotInterval: 50,
  maxRetries: 3,
  baseRetryDelayMs: 100,
  maxRetryDelayMs: 5000,
  deduplicationWindowMs: 300_000,
  deadLetterMaxSize: 1000,
  queryCache: true,
  queryCacheTtlMs: 30_000,
};

export class CqrsEngine {
  readonly eventStore: EventStore;
  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;
  readonly aggregateRepo: AggregateRepository;
  readonly projectionManager: ProjectionManager;
  readonly sagaManager: SagaManager;
  readonly deadLetterQueue: DeadLetterQueue;
  readonly config: CqrsEngineConfig;

  constructor(userConfig: Partial<CqrsEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...userConfig };
    this.eventStore = new EventStore();
    this.deadLetterQueue = new DeadLetterQueue(this.config.deadLetterMaxSize);
    this.commandBus = new CommandBus(this.config, this.deadLetterQueue);
    this.queryBus = new QueryBus(this.config);
    this.aggregateRepo = new AggregateRepository(this.eventStore, this.config.snapshotInterval);
    this.projectionManager = new ProjectionManager();
    this.sagaManager = new SagaManager();

    this.eventStore.subscribeAll(async (event) => { await this.projectionManager.apply(event); });
    logger.info('CQRS Engine initialized', { snapshotInterval: this.config.snapshotInterval, maxRetries: this.config.maxRetries });
  }

  registerCommand(type: string, handler: CommandHandler): void { this.commandBus.register(type, handler); }
  registerQuery<T = unknown>(type: string, handler: QueryHandler<T>): void { this.queryBus.register(type, handler); }
  registerProjection(proj: ProjectionDefinition): void { this.projectionManager.register(proj); }
  registerSaga(def: SagaDefinition): void { this.sagaManager.register(def); }

  registerAggregate(aggregateType: string, appliers: Record<string, EventApplier>): void {
    for (const [et, fn] of Object.entries(appliers)) this.aggregateRepo.registerApplier(aggregateType, et, fn);
  }

  useCommandMiddleware(mw: Middleware): void { this.commandBus.use(mw); }
  useQueryMiddleware(mw: Middleware): void { this.queryBus.use(mw); }

  async dispatchCommand(command: CqrsCommand): Promise<CommandResult> {
    const result = await this.commandBus.dispatch(command);
    if (result.success && result.events.length > 0) await this.eventStore.publish(result.events);
    return result;
  }

  async dispatchQuery<T = unknown>(query: CqrsQuery): Promise<QueryResult<T>> {
    return this.queryBus.dispatch<T>(query);
  }

  async startSaga(sagaId: string, data?: Record<string, unknown>): Promise<SagaContext> {
    return this.sagaManager.start(sagaId, data);
  }

  async replayProjection(name: string): Promise<void> {
    await this.projectionManager.rebuild(name, this.eventStore);
  }

  async retryDeadLetters(filter?: (e: DeadLetterEntry) => boolean): Promise<{ retried: number; succeeded: number }> {
    const entries = this.deadLetterQueue.getUnresolved();
    const toRetry = filter ? entries.filter(filter) : entries;
    let succeeded = 0;
    for (const entry of toRetry) {
      try {
        const result = await this.commandBus.dispatch(entry.command);
        if (result.success) {
          this.deadLetterQueue.resolve(entry.id);
          succeeded++;
          if (result.events.length > 0) await this.eventStore.publish(result.events);
        }
      } catch { logger.warn('DLQ retry failed', { id: entry.id }); }
    }
    logger.info('DLQ retry complete', { retried: toRetry.length, succeeded });
    return { retried: toRetry.length, succeeded };
  }

  getStats(): Record<string, unknown> {
    return {
      totalEvents: this.eventStore.getEventCount(),
      registeredCommands: this.commandBus.getRegisteredCommands(),
      registeredQueries: this.queryBus.getRegisteredQueries(),
      projections: this.projectionManager.listProjections(),
      activeSagas: this.sagaManager.getActiveInstances().length,
      deadLetters: this.deadLetterQueue.size(),
    };
  }

  destroy(): void {
    this.commandBus.destroy();
    logger.info('CQRS Engine destroyed');
  }
}

// ─── Builders ───────────────────────────────────────────────────────────────

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCommand(
  commandType: string, aggregateId: string, payload: Record<string, unknown>,
  metadata: Partial<CommandMetadata> = {}
): CqrsCommand {
  return {
    commandId: uid('cmd'), commandType, aggregateId, payload,
    metadata: { correlationId: metadata.correlationId ?? uid('cor'), ...metadata },
    issuedAt: new Date().toISOString(),
  };
}

export function createQuery(
  queryType: string, params: Record<string, unknown> = {},
  metadata: Partial<CqrsQuery['metadata']> = {}
): CqrsQuery {
  return {
    queryId: uid('qry'), queryType, params,
    metadata: { correlationId: metadata.correlationId ?? uid('cor'), ...metadata },
  };
}

export function createEvent(
  aggregateId: string, aggregateType: string, eventType: string, version: number,
  payload: Record<string, unknown>, metadata: Partial<DomainEvent['metadata']> = {}
): DomainEvent {
  return {
    eventId: uid('evt'), aggregateId, aggregateType, eventType, version, payload,
    metadata: { correlationId: metadata.correlationId ?? uid('cor'), ...metadata },
    occurredAt: new Date().toISOString(),
  };
}

export function createCqrsEngine(config?: Partial<CqrsEngineConfig>): CqrsEngine {
  return new CqrsEngine(config);
}
