import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export class PrometheusMetrics {
  private registry: Registry;

  // HTTP Metrics
  public httpRequestDuration: Histogram;
  public httpRequestTotal: Counter;
  public httpRequestErrors: Counter;

  // Business Metrics
  public postsGenerated: Counter;
  public apiCallsTotal: Counter;
  public subscriptionChanges: Counter;
  public webhookDeliveries: Counter;
  public webhookFailures: Counter;

  // Queue Metrics
  public queueJobsProcessed: Counter;
  public queueJobsFailed: Counter;
  public queueJobDuration: Histogram;
  public queueSize: Gauge;

  // Cache Metrics
  public cacheHits: Counter;
  public cacheMisses: Counter;
  public cacheSize: Gauge;

  // Database Metrics
  public dbQueryDuration: Histogram;
  public dbConnections: Gauge;
  public dbErrors: Counter;

  // AI Metrics
  public aiRequestDuration: Histogram;
  public aiTokensUsed: Counter;
  public aiRequestErrors: Counter;

  // User Metrics
  public activeUsers: Gauge;
  public newSignups: Counter;
  public subscriptionTiers: Gauge;

  // Rate Limit Metrics
  public rateLimitExceeded: Counter;

  constructor() {
    this.registry = new Registry();

    // Enable default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.registry });

    // Initialize HTTP metrics
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestErrors = new Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type'],
      registers: [this.registry],
    });

    // Initialize business metrics
    this.postsGenerated = new Counter({
      name: 'posts_generated_total',
      help: 'Total number of posts generated',
      labelNames: ['category', 'auto_generated'],
      registers: [this.registry],
    });

    this.apiCallsTotal = new Counter({
      name: 'api_calls_total',
      help: 'Total number of API calls',
      labelNames: ['endpoint', 'tier', 'user_id'],
      registers: [this.registry],
    });

    this.subscriptionChanges = new Counter({
      name: 'subscription_changes_total',
      help: 'Total number of subscription changes',
      labelNames: ['from_tier', 'to_tier', 'action'],
      registers: [this.registry],
    });

    this.webhookDeliveries = new Counter({
      name: 'webhook_deliveries_total',
      help: 'Total number of webhook deliveries',
      labelNames: ['event', 'status'],
      registers: [this.registry],
    });

    this.webhookFailures = new Counter({
      name: 'webhook_failures_total',
      help: 'Total number of webhook failures',
      labelNames: ['event', 'reason'],
      registers: [this.registry],
    });

    // Initialize queue metrics
    this.queueJobsProcessed = new Counter({
      name: 'queue_jobs_processed_total',
      help: 'Total number of queue jobs processed',
      labelNames: ['queue', 'job_type', 'status'],
      registers: [this.registry],
    });

    this.queueJobsFailed = new Counter({
      name: 'queue_jobs_failed_total',
      help: 'Total number of queue jobs failed',
      labelNames: ['queue', 'job_type', 'error_type'],
      registers: [this.registry],
    });

    this.queueJobDuration = new Histogram({
      name: 'queue_job_duration_seconds',
      help: 'Duration of queue jobs in seconds',
      labelNames: ['queue', 'job_type'],
      buckets: [1, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    this.queueSize = new Gauge({
      name: 'queue_size',
      help: 'Current size of queues',
      labelNames: ['queue', 'status'],
      registers: [this.registry],
    });

    // Initialize cache metrics
    this.cacheHits = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_key_prefix'],
      registers: [this.registry],
    });

    this.cacheMisses = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_key_prefix'],
      registers: [this.registry],
    });

    this.cacheSize = new Gauge({
      name: 'cache_size_bytes',
      help: 'Current size of cache in bytes',
      labelNames: ['cache_type'],
      registers: [this.registry],
    });

    // Initialize database metrics
    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    });

    this.dbConnections = new Gauge({
      name: 'db_connections_active',
      help: 'Number of active database connections',
      registers: [this.registry],
    });

    this.dbErrors = new Counter({
      name: 'db_errors_total',
      help: 'Total number of database errors',
      labelNames: ['operation', 'error_type'],
      registers: [this.registry],
    });

    // Initialize AI metrics
    this.aiRequestDuration = new Histogram({
      name: 'ai_request_duration_seconds',
      help: 'Duration of AI API requests in seconds',
      labelNames: ['provider', 'model', 'operation'],
      buckets: [1, 2, 5, 10, 20, 30, 60],
      registers: [this.registry],
    });

    this.aiTokensUsed = new Counter({
      name: 'ai_tokens_used_total',
      help: 'Total number of AI tokens used',
      labelNames: ['provider', 'model', 'type'],
      registers: [this.registry],
    });

    this.aiRequestErrors = new Counter({
      name: 'ai_request_errors_total',
      help: 'Total number of AI request errors',
      labelNames: ['provider', 'model', 'error_type'],
      registers: [this.registry],
    });

    // Initialize user metrics
    this.activeUsers = new Gauge({
      name: 'active_users',
      help: 'Number of active users',
      labelNames: ['tier'],
      registers: [this.registry],
    });

    this.newSignups = new Counter({
      name: 'new_signups_total',
      help: 'Total number of new user signups',
      labelNames: ['tier', 'source'],
      registers: [this.registry],
    });

    this.subscriptionTiers = new Gauge({
      name: 'subscription_tiers',
      help: 'Number of users per subscription tier',
      labelNames: ['tier'],
      registers: [this.registry],
    });

    // Initialize rate limit metrics
    this.rateLimitExceeded = new Counter({
      name: 'rate_limit_exceeded_total',
      help: 'Total number of rate limit exceeded events',
      labelNames: ['tier', 'endpoint'],
      registers: [this.registry],
    });
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  /**
   * Get metrics as JSON
   */
  async getMetricsJSON(): Promise<any> {
    return await this.registry.getMetricsAsJSON();
  }

  /**
   * Get registry
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
    this.httpRequestTotal.inc({ method, route, status_code: statusCode });

    if (statusCode >= 400) {
      this.httpRequestErrors.inc({ method, route, error_type: `${statusCode}` });
    }
  }

  /**
   * Record API call
   */
  recordApiCall(endpoint: string, tier: string, userId?: string): void {
    this.apiCallsTotal.inc({ endpoint, tier, user_id: userId || 'anonymous' });
  }

  /**
   * Record post generation
   */
  recordPostGeneration(category: string, autoGenerated: boolean): void {
    this.postsGenerated.inc({ category, auto_generated: autoGenerated.toString() });
  }

  /**
   * Record subscription change
   */
  recordSubscriptionChange(fromTier: string, toTier: string, action: 'upgrade' | 'downgrade' | 'cancel'): void {
    this.subscriptionChanges.inc({ from_tier: fromTier, to_tier: toTier, action });
  }

  /**
   * Record webhook delivery
   */
  recordWebhookDelivery(event: string, status: 'success' | 'failed'): void {
    this.webhookDeliveries.inc({ event, status });
    if (status === 'failed') {
      this.webhookFailures.inc({ event, reason: 'delivery_failed' });
    }
  }

  /**
   * Record queue job
   */
  recordQueueJob(queue: string, jobType: string, status: 'completed' | 'failed', duration: number): void {
    this.queueJobsProcessed.inc({ queue, job_type: jobType, status });
    this.queueJobDuration.observe({ queue, job_type: jobType }, duration);

    if (status === 'failed') {
      this.queueJobsFailed.inc({ queue, job_type: jobType, error_type: 'unknown' });
    }
  }

  /**
   * Update queue size
   */
  updateQueueSize(queue: string, status: string, size: number): void {
    this.queueSize.set({ queue, status }, size);
  }

  /**
   * Record cache operation
   */
  recordCacheOperation(keyPrefix: string, hit: boolean): void {
    if (hit) {
      this.cacheHits.inc({ cache_key_prefix: keyPrefix });
    } else {
      this.cacheMisses.inc({ cache_key_prefix: keyPrefix });
    }
  }

  /**
   * Record database query
   */
  recordDbQuery(operation: string, table: string, duration: number, error?: boolean): void {
    this.dbQueryDuration.observe({ operation, table }, duration);
    if (error) {
      this.dbErrors.inc({ operation, error_type: 'query_failed' });
    }
  }

  /**
   * Record AI request
   */
  recordAiRequest(provider: string, model: string, operation: string, duration: number, tokens?: number): void {
    this.aiRequestDuration.observe({ provider, model, operation }, duration);
    if (tokens) {
      this.aiTokensUsed.inc({ provider, model, type: 'total' }, tokens);
    }
  }

  /**
   * Update active users
   */
  updateActiveUsers(tier: string, count: number): void {
    this.activeUsers.set({ tier }, count);
  }

  /**
   * Record new signup
   */
  recordNewSignup(tier: string, source: string): void {
    this.newSignups.inc({ tier, source });
  }

  /**
   * Record rate limit exceeded
   */
  recordRateLimitExceeded(tier: string, endpoint: string): void {
    this.rateLimitExceeded.inc({ tier, endpoint });
  }
}

// Singleton instance
let prometheusMetricsInstance: PrometheusMetrics | null = null;

export function getPrometheusMetrics(): PrometheusMetrics {
  if (!prometheusMetricsInstance) {
    prometheusMetricsInstance = new PrometheusMetrics();
  }
  return prometheusMetricsInstance;
}
