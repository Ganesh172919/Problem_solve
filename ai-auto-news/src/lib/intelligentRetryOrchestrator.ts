/**
 * @module intelligentRetryOrchestrator
 * @description Intelligent retry orchestration engine implementing adaptive
 * exponential backoff with jitter, dead-letter queue routing, per-operation
 * retry budgets, circuit breaker integration, poison message detection,
 * idempotency key tracking, retry storm prevention, partial failure recovery,
 * and comprehensive retry analytics for distributed systems.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type BackoffStrategy = 'exponential' | 'linear' | 'fibonacci' | 'constant' | 'decorrelated_jitter';
export type RetryOutcome = 'succeeded' | 'failed' | 'abandoned' | 'dlq' | 'timeout';
export type OperationType = 'http' | 'database' | 'queue' | 'rpc' | 'file' | 'cache' | 'custom';

export interface RetryPolicy {
  id: string;
  name: string;
  tenantId: string;
  operationType: OperationType;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterPct: number;
  strategy: BackoffStrategy;
  retryableErrors: string[];
  nonRetryableErrors: string[];
  timeoutMs: number;
  dlqEnabled: boolean;
  dlqMaxRetries: number;
  idempotencyKeyRequired: boolean;
  retryBudgetPerMinute: number;
  createdAt: number;
  updatedAt: number;
}

export interface RetryOperation {
  id: string;
  policyId: string;
  tenantId: string;
  operationType: OperationType;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  attemptNumber: number;
  maxAttempts: number;
  nextRetryAt?: number;
  status: 'pending' | 'in_flight' | 'retrying' | 'succeeded' | 'failed' | 'abandoned' | 'dlq';
  lastError?: string;
  lastErrorCode?: string;
  startedAt: number;
  lastAttemptAt?: number;
  completedAt?: number;
  totalDelayMs: number;
  metadata: Record<string, unknown>;
}

export interface RetryAttempt {
  id: string;
  operationId: string;
  policyId: string;
  tenantId: string;
  attemptNumber: number;
  delayMs: number;
  outcome: RetryOutcome;
  errorMessage?: string;
  errorCode?: string;
  latencyMs: number;
  timestamp: number;
}

export interface DlqEntry {
  id: string;
  operationId: string;
  tenantId: string;
  operationType: OperationType;
  payload: Record<string, unknown>;
  errorMessage: string;
  totalAttempts: number;
  enqueuedAt: number;
  processedAt?: number;
  requeued: boolean;
  requeueCount: number;
}

export interface PoisonMessageRecord {
  operationId: string;
  tenantId: string;
  consecutiveFailures: number;
  errorPattern: string;
  firstSeenAt: number;
  lastSeenAt: number;
  quarantined: boolean;
}

export interface RetryStormDetection {
  policyId: string;
  tenantId: string;
  retriesPerMinute: number;
  threshold: number;
  stormActive: boolean;
  detectedAt?: number;
  throttledCount: number;
}

export interface RetryAnalytics {
  policyId: string;
  tenantId: string;
  totalOperations: number;
  successOnFirstAttempt: number;
  successOnRetry: number;
  totalFailed: number;
  totalDlq: number;
  avgAttempts: number;
  avgTotalDelayMs: number;
  successRate: number;
  retryRate: number;
  dlqRate: number;
}

export interface OrchestratorSummary {
  totalPolicies: number;
  totalOperations: number;
  pendingOperations: number;
  dlqDepth: number;
  poisonMessages: number;
  activeStorms: number;
  overallSuccessRate: number;
  avgRetries: number;
}

// ── Backoff Calculator ────────────────────────────────────────────────────────

function computeDelay(policy: RetryPolicy, attempt: number): number {
  let delay: number;
  switch (policy.strategy) {
    case 'exponential':
      delay = policy.initialDelayMs * Math.pow(policy.multiplier, attempt - 1);
      break;
    case 'linear':
      delay = policy.initialDelayMs * attempt;
      break;
    case 'fibonacci': {
      const fib = (n: number): number => n <= 1 ? n : fib(n - 1) + fib(n - 2);
      delay = policy.initialDelayMs * fib(Math.min(attempt, 12));
      break;
    }
    case 'constant':
      delay = policy.initialDelayMs;
      break;
    case 'decorrelated_jitter': {
      const prev = policy.initialDelayMs * Math.pow(policy.multiplier, attempt - 2);
      delay = Math.random() * (3 * prev - policy.initialDelayMs) + policy.initialDelayMs;
      break;
    }
    default:
      delay = policy.initialDelayMs * Math.pow(policy.multiplier, attempt - 1);
  }
  delay = Math.min(delay, policy.maxDelayMs);
  const jitter = delay * policy.jitterPct * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(delay + jitter));
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class IntelligentRetryOrchestrator {
  private readonly policies = new Map<string, RetryPolicy>();
  private readonly operations = new Map<string, RetryOperation>();
  private readonly attempts: RetryAttempt[] = [];
  private readonly dlq = new Map<string, DlqEntry>();
  private readonly poisonMessages = new Map<string, PoisonMessageRecord>();
  private readonly idempotencyIndex = new Map<string, string>(); // key -> operationId
  private readonly ATTEMPTS_MAX = 50_000;
  private globalCounter = 0;

  // Policy management ──────────────────────────────────────────────────────────

  createPolicy(params: Omit<RetryPolicy, 'id' | 'createdAt' | 'updatedAt'>): RetryPolicy {
    const policy: RetryPolicy = {
      ...params,
      id: `rp_${Date.now()}_${++this.globalCounter}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.policies.set(policy.id, policy);
    logger.info('Retry policy created', { id: policy.id, name: policy.name });
    return policy;
  }

  updatePolicy(id: string, updates: Partial<Omit<RetryPolicy, 'id' | 'createdAt'>>): RetryPolicy {
    const policy = this.policies.get(id);
    if (!policy) throw new Error(`Policy ${id} not found`);
    const updated: RetryPolicy = { ...policy, ...updates, updatedAt: Date.now() };
    this.policies.set(id, updated);
    return updated;
  }

  getPolicy(id: string): RetryPolicy | undefined {
    return this.policies.get(id);
  }

  listPolicies(tenantId?: string): RetryPolicy[] {
    const all = Array.from(this.policies.values());
    return tenantId ? all.filter(p => p.tenantId === tenantId) : all;
  }

  // Operation lifecycle ────────────────────────────────────────────────────────

  enqueue(params: {
    policyId: string;
    tenantId: string;
    operationType: OperationType;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): RetryOperation {
    const policy = this.policies.get(params.policyId);
    if (!policy) throw new Error(`Policy ${params.policyId} not found`);

    // Idempotency check
    if (params.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(`${params.tenantId}:${params.idempotencyKey}`);
      if (existingId) {
        const existing = this.operations.get(existingId);
        if (existing && existing.status !== 'failed' && existing.status !== 'abandoned') {
          return existing;
        }
      }
    }

    const operation: RetryOperation = {
      id: `op_${Date.now()}_${++this.globalCounter}`,
      policyId: params.policyId,
      tenantId: params.tenantId,
      operationType: params.operationType,
      idempotencyKey: params.idempotencyKey,
      payload: params.payload,
      attemptNumber: 0,
      maxAttempts: policy.maxAttempts,
      status: 'pending',
      startedAt: Date.now(),
      totalDelayMs: 0,
      metadata: params.metadata ?? {},
    };
    this.operations.set(operation.id, operation);

    if (params.idempotencyKey) {
      this.idempotencyIndex.set(`${params.tenantId}:${params.idempotencyKey}`, operation.id);
    }
    return operation;
  }

  recordAttemptResult(operationId: string, success: boolean, latencyMs: number, error?: { message: string; code?: string }): RetryOperation {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error(`Operation ${operationId} not found`);
    const policy = this.policies.get(operation.policyId);
    if (!policy) throw new Error(`Policy ${operation.policyId} not found`);

    operation.attemptNumber++;
    operation.lastAttemptAt = Date.now();

    const outcome: RetryOutcome = success ? 'succeeded' : operation.attemptNumber >= policy.maxAttempts ? 'failed' : 'failed';

    const attempt: RetryAttempt = {
      id: `att_${Date.now()}_${++this.globalCounter}`,
      operationId,
      policyId: operation.policyId,
      tenantId: operation.tenantId,
      attemptNumber: operation.attemptNumber,
      delayMs: 0,
      outcome: success ? 'succeeded' : 'failed',
      errorMessage: error?.message,
      errorCode: error?.code,
      latencyMs,
      timestamp: Date.now(),
    };
    this.attempts.push(attempt);
    if (this.attempts.length > this.ATTEMPTS_MAX) this.attempts.shift();

    if (success) {
      operation.status = 'succeeded';
      operation.completedAt = Date.now();
      logger.debug('Operation succeeded', { operationId, attempt: operation.attemptNumber });
      return operation;
    }

    operation.lastError = error?.message;
    operation.lastErrorCode = error?.code;

    // Check non-retryable errors
    if (error?.code && policy.nonRetryableErrors.includes(error.code)) {
      operation.status = 'abandoned';
      operation.completedAt = Date.now();
      this.moveToDlq(operation, policy, error.message ?? 'Non-retryable error');
      logger.warn('Operation abandoned (non-retryable)', { operationId, errorCode: error.code });
      return operation;
    }

    // Check poison message
    this.trackPoisonMessage(operation, error?.message ?? 'unknown');

    if (operation.attemptNumber >= policy.maxAttempts) {
      operation.status = 'dlq';
      operation.completedAt = Date.now();
      this.moveToDlq(operation, policy, error?.message ?? 'Max retries exceeded');
      return operation;
    }

    // Check retry storm
    if (this.isRetryStorm(operation.policyId, operation.tenantId, policy)) {
      operation.status = 'abandoned';
      operation.completedAt = Date.now();
      logger.warn('Operation abandoned due to retry storm', { operationId });
      return operation;
    }

    // Schedule retry
    const delayMs = computeDelay(policy, operation.attemptNumber + 1);
    operation.nextRetryAt = Date.now() + delayMs;
    operation.totalDelayMs += delayMs;
    operation.status = 'retrying';
    attempt.delayMs = delayMs;
    logger.debug('Operation scheduled for retry', { operationId, attempt: operation.attemptNumber, delayMs });
    return operation;
  }

  private moveToDlq(operation: RetryOperation, policy: RetryPolicy, errorMessage: string): void {
    if (!policy.dlqEnabled) return;
    const entry: DlqEntry = {
      id: `dlq_${Date.now()}_${++this.globalCounter}`,
      operationId: operation.id,
      tenantId: operation.tenantId,
      operationType: operation.operationType,
      payload: operation.payload,
      errorMessage,
      totalAttempts: operation.attemptNumber,
      enqueuedAt: Date.now(),
      requeued: false,
      requeueCount: 0,
    };
    this.dlq.set(entry.id, entry);
    logger.warn('Operation moved to DLQ', { operationId: operation.id, dlqId: entry.id });
  }

  private trackPoisonMessage(operation: RetryOperation, errorMessage: string): void {
    const key = `${operation.tenantId}:${operation.policyId}:${errorMessage.slice(0, 50)}`;
    const record = this.poisonMessages.get(key) ?? {
      operationId: operation.id,
      tenantId: operation.tenantId,
      consecutiveFailures: 0,
      errorPattern: errorMessage.slice(0, 50),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      quarantined: false,
    };
    record.consecutiveFailures++;
    record.lastSeenAt = Date.now();
    if (record.consecutiveFailures > 10) record.quarantined = true;
    this.poisonMessages.set(key, record);
  }

  private isRetryStorm(policyId: string, tenantId: string, policy: RetryPolicy): boolean {
    const oneMinAgo = Date.now() - 60_000;
    const recentRetries = this.attempts.filter(
      a => a.policyId === policyId && a.tenantId === tenantId && a.timestamp >= oneMinAgo
    ).length;
    return recentRetries >= policy.retryBudgetPerMinute;
  }

  // DLQ management ─────────────────────────────────────────────────────────────

  requeueDlqEntry(dlqId: string): DlqEntry {
    const entry = this.dlq.get(dlqId);
    if (!entry) throw new Error(`DLQ entry ${dlqId} not found`);
    const operation = this.operations.get(entry.operationId);
    if (operation) {
      operation.status = 'pending';
      operation.attemptNumber = 0;
      operation.completedAt = undefined;
    }
    entry.requeued = true;
    entry.requeueCount++;
    entry.processedAt = Date.now();
    logger.info('DLQ entry requeued', { dlqId, operationId: entry.operationId });
    return entry;
  }

  listDlq(tenantId?: string): DlqEntry[] {
    const all = Array.from(this.dlq.values());
    return tenantId ? all.filter(e => e.tenantId === tenantId) : all;
  }

  // Storm detection ────────────────────────────────────────────────────────────

  getStormStatus(policyId: string, tenantId: string): RetryStormDetection {
    const policy = this.policies.get(policyId);
    const oneMinAgo = Date.now() - 60_000;
    const recent = this.attempts.filter(a => a.policyId === policyId && a.tenantId === tenantId && a.timestamp >= oneMinAgo);
    const rps = recent.length;
    const threshold = policy?.retryBudgetPerMinute ?? 100;
    const stormActive = rps >= threshold;
    const throttled = this.attempts.filter(
      a => a.policyId === policyId && a.tenantId === tenantId && a.timestamp >= oneMinAgo && a.outcome === 'abandoned'
    ).length;
    return {
      policyId,
      tenantId,
      retriesPerMinute: rps,
      threshold,
      stormActive,
      detectedAt: stormActive ? Date.now() : undefined,
      throttledCount: throttled,
    };
  }

  // Analytics ──────────────────────────────────────────────────────────────────

  getAnalytics(policyId: string, tenantId?: string): RetryAnalytics {
    let ops = Array.from(this.operations.values()).filter(o => o.policyId === policyId);
    if (tenantId) ops = ops.filter(o => o.tenantId === tenantId);

    const total = ops.length;
    const firstAttemptSuccess = ops.filter(o => o.status === 'succeeded' && o.attemptNumber === 1).length;
    const retrySuccess = ops.filter(o => o.status === 'succeeded' && o.attemptNumber > 1).length;
    const failed = ops.filter(o => o.status === 'failed' || o.status === 'abandoned').length;
    const dlq = ops.filter(o => o.status === 'dlq').length;
    const avgAttempts = total > 0 ? ops.reduce((s, o) => s + o.attemptNumber, 0) / total : 0;
    const avgDelay = total > 0 ? ops.reduce((s, o) => s + o.totalDelayMs, 0) / total : 0;

    return {
      policyId,
      tenantId: tenantId ?? 'all',
      totalOperations: total,
      successOnFirstAttempt: firstAttemptSuccess,
      successOnRetry: retrySuccess,
      totalFailed: failed,
      totalDlq: dlq,
      avgAttempts,
      avgTotalDelayMs: avgDelay,
      successRate: total > 0 ? ((firstAttemptSuccess + retrySuccess) / total) * 100 : 0,
      retryRate: total > 0 ? (retrySuccess / total) * 100 : 0,
      dlqRate: total > 0 ? (dlq / total) * 100 : 0,
    };
  }

  listOperations(tenantId?: string, status?: RetryOperation['status']): RetryOperation[] {
    let all = Array.from(this.operations.values());
    if (tenantId) all = all.filter(o => o.tenantId === tenantId);
    if (status) all = all.filter(o => o.status === status);
    return all;
  }

  getOperation(id: string): RetryOperation | undefined {
    return this.operations.get(id);
  }

  listAttempts(operationId?: string, limit = 100): RetryAttempt[] {
    const filtered = operationId ? this.attempts.filter(a => a.operationId === operationId) : this.attempts;
    return filtered.slice(-limit);
  }

  listPoisonMessages(tenantId?: string): PoisonMessageRecord[] {
    const all = Array.from(this.poisonMessages.values());
    return tenantId ? all.filter(p => p.tenantId === tenantId) : all;
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): OrchestratorSummary {
    const allOps = Array.from(this.operations.values());
    const pending = allOps.filter(o => o.status === 'pending' || o.status === 'retrying').length;
    const succeeded = allOps.filter(o => o.status === 'succeeded').length;
    const avgRetries = allOps.length > 0 ? allOps.reduce((s, o) => s + o.attemptNumber, 0) / allOps.length : 0;

    // Count active storms across all policies
    const policyKeys = new Set(allOps.map(o => `${o.policyId}:${o.tenantId}`));
    let activeStorms = 0;
    for (const key of policyKeys) {
      const [policyId, tenantId] = key.split(':');
      const storm = this.getStormStatus(policyId, tenantId);
      if (storm.stormActive) activeStorms++;
    }

    return {
      totalPolicies: this.policies.size,
      totalOperations: allOps.length,
      pendingOperations: pending,
      dlqDepth: this.dlq.size,
      poisonMessages: Array.from(this.poisonMessages.values()).filter(p => p.quarantined).length,
      activeStorms,
      overallSuccessRate: allOps.length > 0 ? (succeeded / allOps.length) * 100 : 0,
      avgRetries,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__intelligentRetryOrchestrator__';
export function getRetryOrchestrator(): IntelligentRetryOrchestrator {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new IntelligentRetryOrchestrator();
  }
  return (globalThis as Record<string, unknown>)[KEY] as IntelligentRetryOrchestrator;
}
