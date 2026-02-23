import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeliveryStatus = 'pending' | 'in_progress' | 'delivered' | 'failed' | 'dead_letter';

type HttpMethod = 'POST' | 'PUT' | 'PATCH';

interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  method: HttpMethod;
  headers: Record<string, string>;
  retryPolicy: RetryPolicy;
  active: boolean;
  createdAt: number;
  healthScore: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  averageLatencyMs: number;
}

interface DeliveryAttempt {
  attemptNumber: number;
  timestamp: number;
  statusCode: number | null;
  responseBody: string | null;
  latencyMs: number;
  error: string | null;
  success: boolean;
}

interface DeliveryRecord {
  id: string;
  endpointId: string;
  event: string;
  payload: unknown;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  createdAt: number;
  updatedAt: number;
  nextRetryAt: number | null;
  completedAt: number | null;
  signature: string;
}

interface DeadLetterEntry {
  deliveryId: string;
  endpointId: string;
  event: string;
  payload: unknown;
  lastAttempt: DeliveryAttempt;
  failedAt: number;
  reason: string;
}

interface BatchDeliveryResult {
  total: number;
  succeeded: number;
  failed: number;
  deliveryIds: string[];
}

interface WebhookDeliveryMetrics {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  deadLetterCount: number;
  pendingDeliveries: number;
  averageLatencyMs: number;
  endpointCount: number;
}

interface WebhookDeliveryConfig {
  maxConcurrentDeliveries: number;
  deliveryTimeoutMs: number;
  maxDeadLetterSize: number;
  cleanupIntervalMs: number;
  maxRecordAge: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

const DEFAULT_CONFIG: WebhookDeliveryConfig = {
  maxConcurrentDeliveries: 50,
  deliveryTimeoutMs: 30000,
  maxDeadLetterSize: 10000,
  cleanupIntervalMs: 300000,
  maxRecordAge: 604800000, // 7 days
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${ts}-${rand}`;
}

async function computeHmacSha256(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(payload);

  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await globalThis.crypto.subtle.sign('HMAC', key, msgData);
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback: simple hash for environments without Web Crypto
  let hash = 0;
  const combined = payload + secret;
  for (let i = 0; i < combined.length; i++) {
    const chr = combined.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

function calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  const jitter = delay * 0.1 * Math.random();
  return Math.min(delay + jitter, policy.maxDelayMs);
}

// ─── WebhookDeliveryEngine ────────────────────────────────────────────────────

export class WebhookDeliveryEngine {
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private deliveries: Map<string, DeliveryRecord> = new Map();
  private deadLetterQueue: DeadLetterEntry[] = [];
  private config: WebhookDeliveryConfig;
  private activeDeliveries = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(config?: Partial<WebhookDeliveryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    logger.info('WebhookDeliveryEngine initialized', {
      maxConcurrent: this.config.maxConcurrentDeliveries,
      timeoutMs: this.config.deliveryTimeoutMs,
    });
  }

  /**
   * Register a webhook endpoint for deliveries.
   */
  registerEndpoint(
    url: string,
    secret: string,
    options?: { method?: HttpMethod; headers?: Record<string, string>; retryPolicy?: Partial<RetryPolicy> },
  ): WebhookEndpoint {
    if (!url || !secret) throw new Error('WebhookDeliveryEngine: url and secret are required');

    const id = generateId();
    const endpoint: WebhookEndpoint = {
      id,
      url,
      secret,
      method: options?.method ?? 'POST',
      headers: options?.headers ?? {},
      retryPolicy: { ...DEFAULT_RETRY_POLICY, ...options?.retryPolicy },
      active: true,
      createdAt: Date.now(),
      healthScore: 1.0,
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatencyMs: 0,
    };

    this.endpoints.set(id, endpoint);
    logger.info('WebhookDeliveryEngine: endpoint registered', { id, url });
    return { ...endpoint };
  }

  /**
   * Remove a webhook endpoint and cancel pending deliveries.
   */
  removeEndpoint(endpointId: string): boolean {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return false;

    endpoint.active = false;
    this.endpoints.delete(endpointId);

    // Cancel pending deliveries for this endpoint
    for (const [id, delivery] of this.deliveries) {
      if (delivery.endpointId === endpointId && delivery.status === 'pending') {
        delivery.status = 'failed';
        delivery.updatedAt = Date.now();
        const timer = this.retryTimers.get(id);
        if (timer) {
          clearTimeout(timer);
          this.retryTimers.delete(id);
        }
      }
    }

    logger.info('WebhookDeliveryEngine: endpoint removed', { endpointId });
    return true;
  }

  /**
   * Deliver a webhook event to a specific endpoint.
   */
  async deliver(endpointId: string, event: string, payload: unknown): Promise<DeliveryRecord> {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`WebhookDeliveryEngine: endpoint "${endpointId}" not found`);
    if (!endpoint.active) throw new Error(`WebhookDeliveryEngine: endpoint "${endpointId}" is inactive`);

    const payloadStr = JSON.stringify(payload);
    const signature = await computeHmacSha256(payloadStr, endpoint.secret);
    const deliveryId = generateId();

    const record: DeliveryRecord = {
      id: deliveryId,
      endpointId,
      event,
      payload,
      status: 'pending',
      attempts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRetryAt: null,
      completedAt: null,
      signature,
    };

    this.deliveries.set(deliveryId, record);
    await this.executeDelivery(record, endpoint);
    return { ...record };
  }

  /**
   * Deliver a webhook event to all active endpoints.
   */
  async broadcast(event: string, payload: unknown): Promise<BatchDeliveryResult> {
    const activeEndpoints = Array.from(this.endpoints.values()).filter((e) => e.active);
    const deliveryIds: string[] = [];
    let succeeded = 0;
    let failed = 0;

    const promises = activeEndpoints.map(async (endpoint) => {
      try {
        const record = await this.deliver(endpoint.id, event, payload);
        deliveryIds.push(record.id);
        if (record.status === 'delivered') succeeded++;
        else failed++;
      } catch {
        failed++;
      }
    });

    await Promise.allSettled(promises);

    return { total: activeEndpoints.length, succeeded, failed, deliveryIds };
  }

  /**
   * Deliver the same event to multiple endpoints in a single batch.
   */
  async batchDeliver(
    endpointIds: string[],
    event: string,
    payload: unknown,
  ): Promise<BatchDeliveryResult> {
    const deliveryIds: string[] = [];
    let succeeded = 0;
    let failed = 0;

    const uniqueIds = [...new Set(endpointIds)];
    const promises = uniqueIds.map(async (eid) => {
      try {
        const record = await this.deliver(eid, event, payload);
        deliveryIds.push(record.id);
        if (record.status === 'delivered') succeeded++;
        else failed++;
      } catch {
        failed++;
      }
    });

    await Promise.allSettled(promises);

    return { total: uniqueIds.length, succeeded, failed, deliveryIds };
  }

  /**
   * Retry a specific failed delivery.
   */
  async retryDelivery(deliveryId: string): Promise<DeliveryRecord | null> {
    const record = this.deliveries.get(deliveryId);
    if (!record) return null;
    if (record.status !== 'failed' && record.status !== 'dead_letter') return null;

    const endpoint = this.endpoints.get(record.endpointId);
    if (!endpoint || !endpoint.active) return null;

    record.status = 'pending';
    record.updatedAt = Date.now();
    await this.executeDelivery(record, endpoint);
    return { ...record };
  }

  /**
   * Get a delivery record by ID.
   */
  getDelivery(deliveryId: string): DeliveryRecord | null {
    const record = this.deliveries.get(deliveryId);
    return record ? { ...record, attempts: [...record.attempts] } : null;
  }

  /**
   * Get the dead letter queue entries.
   */
  getDeadLetterQueue(limit?: number): DeadLetterEntry[] {
    const entries = this.deadLetterQueue.slice(0, limit ?? this.deadLetterQueue.length);
    return entries.map((e) => ({ ...e }));
  }

  /**
   * Remove an entry from the dead letter queue and optionally requeue it.
   */
  async replayDeadLetter(deliveryId: string): Promise<DeliveryRecord | null> {
    const idx = this.deadLetterQueue.findIndex((e) => e.deliveryId === deliveryId);
    if (idx === -1) return null;

    const entry = this.deadLetterQueue[idx];
    this.deadLetterQueue.splice(idx, 1);

    const endpoint = this.endpoints.get(entry.endpointId);
    if (!endpoint || !endpoint.active) return null;

    return this.deliver(entry.endpointId, entry.event, entry.payload);
  }

  /**
   * Get health score for an endpoint (0.0 to 1.0).
   */
  getEndpointHealth(endpointId: string): number {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return 0;
    return endpoint.healthScore;
  }

  /**
   * Get a registered endpoint by ID.
   */
  getEndpoint(endpointId: string): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    return endpoint ? { ...endpoint } : null;
  }

  /**
   * List all registered endpoints.
   */
  listEndpoints(): WebhookEndpoint[] {
    return Array.from(this.endpoints.values()).map((e) => ({ ...e }));
  }

  /**
   * Get delivery metrics.
   */
  getMetrics(): WebhookDeliveryMetrics {
    let totalLatency = 0;
    let latencyCount = 0;
    let pending = 0;
    let successful = 0;
    let failed = 0;

    for (const record of this.deliveries.values()) {
      if (record.status === 'pending' || record.status === 'in_progress') pending++;
      else if (record.status === 'delivered') successful++;
      else failed++;

      for (const attempt of record.attempts) {
        if (attempt.latencyMs > 0) {
          totalLatency += attempt.latencyMs;
          latencyCount++;
        }
      }
    }

    return {
      totalDeliveries: this.deliveries.size,
      successfulDeliveries: successful,
      failedDeliveries: failed,
      deadLetterCount: this.deadLetterQueue.length,
      pendingDeliveries: pending,
      averageLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      endpointCount: this.endpoints.size,
    };
  }

  /**
   * Clear completed deliveries older than a specified age.
   */
  purgeOldRecords(maxAgeMs?: number): number {
    const cutoff = Date.now() - (maxAgeMs ?? this.config.maxRecordAge);
    let purged = 0;

    for (const [id, record] of this.deliveries) {
      if (record.completedAt && record.completedAt < cutoff) {
        this.deliveries.delete(id);
        purged++;
      }
    }

    if (purged > 0) {
      logger.info('WebhookDeliveryEngine: purged old records', { purged });
    }
    return purged;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.endpoints.clear();
    this.deliveries.clear();
    this.deadLetterQueue.length = 0;
    this.activeDeliveries = 0;
    logger.info('WebhookDeliveryEngine destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async executeDelivery(record: DeliveryRecord, endpoint: WebhookEndpoint): Promise<void> {
    if (this.activeDeliveries >= this.config.maxConcurrentDeliveries) {
      const delay = calculateBackoffDelay(0, endpoint.retryPolicy);
      record.nextRetryAt = Date.now() + delay;
      this.scheduleRetry(record.id, delay);
      return;
    }

    record.status = 'in_progress';
    record.updatedAt = Date.now();
    this.activeDeliveries++;

    const attemptNumber = record.attempts.length + 1;
    const startTime = Date.now();

    try {
      const payloadStr = JSON.stringify(record.payload);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.deliveryTimeoutMs);

      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': record.signature,
          'X-Webhook-Event': record.event,
          'X-Webhook-Delivery': record.id,
          'X-Webhook-Timestamp': startTime.toString(),
          ...endpoint.headers,
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;
      const responseBody = await response.text().catch(() => null);

      const attempt: DeliveryAttempt = {
        attemptNumber,
        timestamp: startTime,
        statusCode: response.status,
        responseBody: responseBody?.substring(0, 1024) ?? null,
        latencyMs,
        error: null,
        success: response.ok,
      };

      record.attempts.push(attempt);
      this.activeDeliveries--;

      if (response.ok) {
        this.markDelivered(record, endpoint, latencyMs);
      } else if (endpoint.retryPolicy.retryableStatusCodes.includes(response.status)) {
        this.handleRetry(record, endpoint, `HTTP ${response.status}`);
      } else {
        this.markFailed(record, endpoint, `Non-retryable HTTP ${response.status}`);
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      const isAbort = error.name === 'AbortError';

      const attempt: DeliveryAttempt = {
        attemptNumber,
        timestamp: startTime,
        statusCode: null,
        responseBody: null,
        latencyMs,
        error: isAbort ? 'Request timed out' : error.message,
        success: false,
      };

      record.attempts.push(attempt);
      this.activeDeliveries--;
      this.handleRetry(record, endpoint, attempt.error ?? 'Unknown error');
    }
  }

  private markDelivered(record: DeliveryRecord, endpoint: WebhookEndpoint, latencyMs: number): void {
    record.status = 'delivered';
    record.completedAt = Date.now();
    record.updatedAt = Date.now();
    record.nextRetryAt = null;

    endpoint.totalDeliveries++;
    endpoint.successfulDeliveries++;
    this.updateEndpointHealth(endpoint);
    this.updateEndpointLatency(endpoint, latencyMs);

    logger.debug('WebhookDeliveryEngine: delivery succeeded', {
      deliveryId: record.id,
      endpointId: endpoint.id,
      latencyMs,
    });
  }

  private markFailed(record: DeliveryRecord, endpoint: WebhookEndpoint, reason: string): void {
    record.status = 'failed';
    record.completedAt = Date.now();
    record.updatedAt = Date.now();
    record.nextRetryAt = null;

    endpoint.totalDeliveries++;
    endpoint.failedDeliveries++;
    this.updateEndpointHealth(endpoint);
    this.moveToDeadLetter(record, reason);

    logger.warn('WebhookDeliveryEngine: delivery permanently failed', {
      deliveryId: record.id,
      endpointId: endpoint.id,
      reason,
    });
  }

  private handleRetry(record: DeliveryRecord, endpoint: WebhookEndpoint, reason: string): void {
    const attemptCount = record.attempts.length;

    if (attemptCount >= endpoint.retryPolicy.maxRetries) {
      this.markFailed(record, endpoint, `Max retries exceeded: ${reason}`);
      return;
    }

    const delay = calculateBackoffDelay(attemptCount, endpoint.retryPolicy);
    record.status = 'pending';
    record.nextRetryAt = Date.now() + delay;
    record.updatedAt = Date.now();

    this.scheduleRetry(record.id, delay);

    logger.debug('WebhookDeliveryEngine: scheduling retry', {
      deliveryId: record.id,
      attempt: attemptCount,
      delayMs: Math.round(delay),
    });
  }

  private scheduleRetry(deliveryId: string, delayMs: number): void {
    const existing = this.retryTimers.get(deliveryId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.retryTimers.delete(deliveryId);
      const record = this.deliveries.get(deliveryId);
      if (!record || record.status !== 'pending') return;

      const endpoint = this.endpoints.get(record.endpointId);
      if (!endpoint || !endpoint.active) {
        record.status = 'failed';
        record.updatedAt = Date.now();
        return;
      }

      await this.executeDelivery(record, endpoint);
    }, delayMs);

    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.retryTimers.set(deliveryId, timer);
  }

  private moveToDeadLetter(record: DeliveryRecord, reason: string): void {
    record.status = 'dead_letter';
    record.updatedAt = Date.now();

    const lastAttempt = record.attempts[record.attempts.length - 1];
    if (!lastAttempt) return;

    const entry: DeadLetterEntry = {
      deliveryId: record.id,
      endpointId: record.endpointId,
      event: record.event,
      payload: record.payload,
      lastAttempt: { ...lastAttempt },
      failedAt: Date.now(),
      reason,
    };

    this.deadLetterQueue.push(entry);

    // Trim dead letter queue if it exceeds max size
    while (this.deadLetterQueue.length > this.config.maxDeadLetterSize) {
      this.deadLetterQueue.shift();
    }
  }

  private updateEndpointHealth(endpoint: WebhookEndpoint): void {
    if (endpoint.totalDeliveries === 0) {
      endpoint.healthScore = 1.0;
      return;
    }

    // Weighted health: recent deliveries have more impact
    const successRate = endpoint.successfulDeliveries / endpoint.totalDeliveries;
    // Blend overall rate with a bias toward 1.0 for new endpoints
    const weight = Math.min(endpoint.totalDeliveries / 100, 1.0);
    endpoint.healthScore = Math.round((successRate * weight + 1.0 * (1 - weight)) * 100) / 100;
  }

  private updateEndpointLatency(endpoint: WebhookEndpoint, latencyMs: number): void {
    if (endpoint.averageLatencyMs === 0) {
      endpoint.averageLatencyMs = latencyMs;
    } else {
      // Exponential moving average
      const alpha = 0.2;
      endpoint.averageLatencyMs = Math.round(
        alpha * latencyMs + (1 - alpha) * endpoint.averageLatencyMs,
      );
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.config.maxRecordAge;
    let removed = 0;

    for (const [id, record] of this.deliveries) {
      if (record.completedAt && record.completedAt < cutoff) {
        this.deliveries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('WebhookDeliveryEngine: cleanup completed', { removed });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getWebhookDeliveryEngine(): WebhookDeliveryEngine {
  const g = globalThis as unknown as Record<string, WebhookDeliveryEngine>;
  if (!g.__webhookDeliveryEngine__) {
    g.__webhookDeliveryEngine__ = new WebhookDeliveryEngine();
  }
  return g.__webhookDeliveryEngine__;
}
