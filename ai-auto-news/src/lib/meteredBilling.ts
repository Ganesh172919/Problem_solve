/**
 * Metered Billing System - Usage-Based Pricing
 *
 * Supports:
 * - Per-request billing
 * - Token consumption tracking
 * - Compute time billing
 * - Storage usage billing
 * - Bandwidth billing
 * - Custom metric billing
 */

import { getDb as getDB } from '../db/index';
import { getLogger } from './logger';
import { Stripe } from 'stripe';

const logger = getLogger();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export interface MeterEvent {
  userId: string;
  organizationId: string;
  metricName: string;
  value: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface UsageMetric {
  name: string;
  unit: string; // 'requests', 'tokens', 'compute_seconds', 'gb_storage', 'gb_bandwidth'
  pricePerUnit: number; // in cents
  includedInTier: Record<string, number>; // Free tier allowances
  billingMode: 'postpaid' | 'prepaid';
  aggregationPeriod: 'hourly' | 'daily' | 'monthly';
}

export interface UsageSummary {
  userId: string;
  organizationId: string;
  period: { start: Date; end: Date };
  metrics: Map<string, MetricUsage>;
  totalCost: number;
  creditsUsed: number;
  overage: number;
}

export interface MetricUsage {
  metric: string;
  quantity: number;
  includedQuantity: number;
  billableQuantity: number;
  unitPrice: number;
  totalCost: number;
}

export interface BillingTier {
  name: string;
  basePrice: number; // Monthly subscription price in cents
  includedUsage: Record<string, number>; // Included allowances
  overageRates: Record<string, number>; // Per-unit overage prices
}

// Define billing metrics
export const USAGE_METRICS: Record<string, UsageMetric> = {
  API_REQUESTS: {
    name: 'api_requests',
    unit: 'requests',
    pricePerUnit: 0.01, // $0.0001 per request
    includedInTier: {
      free: 1000,
      pro: 100000,
      enterprise: 10000000,
    },
    billingMode: 'postpaid',
    aggregationPeriod: 'monthly',
  },
  AI_TOKENS: {
    name: 'ai_tokens',
    unit: 'tokens',
    pricePerUnit: 0.001, // $0.00001 per token
    includedInTier: {
      free: 10000,
      pro: 1000000,
      enterprise: 100000000,
    },
    billingMode: 'postpaid',
    aggregationPeriod: 'monthly',
  },
  COMPUTE_TIME: {
    name: 'compute_seconds',
    unit: 'seconds',
    pricePerUnit: 0.1, // $0.001 per second
    includedInTier: {
      free: 60,
      pro: 36000, // 10 hours
      enterprise: 3600000, // 1000 hours
    },
    billingMode: 'postpaid',
    aggregationPeriod: 'monthly',
  },
  STORAGE: {
    name: 'gb_storage',
    unit: 'gigabytes',
    pricePerUnit: 10, // $0.10 per GB per month
    includedInTier: {
      free: 1,
      pro: 100,
      enterprise: 10000,
    },
    billingMode: 'postpaid',
    aggregationPeriod: 'monthly',
  },
  BANDWIDTH: {
    name: 'gb_bandwidth',
    unit: 'gigabytes',
    pricePerUnit: 8, // $0.08 per GB
    includedInTier: {
      free: 10,
      pro: 1000,
      enterprise: 100000,
    },
    billingMode: 'postpaid',
    aggregationPeriod: 'monthly',
  },
};

class MeteredBillingEngine {
  private db = getDB();
  private eventBuffer: MeterEvent[] = [];
  private bufferSize = 100;
  private flushInterval = 5000; // 5 seconds

  constructor() {
    // Start background flush
    this.startBackgroundFlush();
  }

  /**
   * Record a usage event
   */
  async recordUsage(event: MeterEvent): Promise<void> {
    // Add to buffer
    this.eventBuffer.push(event);

    // Flush if buffer full
    if (this.eventBuffer.length >= this.bufferSize) {
      await this.flushEvents();
    }

    // Also send to Stripe Billing Meter
    await this.sendToStripeMeter(event);
  }

  /**
   * Record API request usage
   */
  async recordAPIRequest(userId: string, organizationId: string, endpoint: string): Promise<void> {
    await this.recordUsage({
      userId,
      organizationId,
      metricName: 'api_requests',
      value: 1,
      timestamp: new Date(),
      metadata: { endpoint },
    });
  }

  /**
   * Record AI token usage
   */
  async recordAITokens(
    userId: string,
    organizationId: string,
    tokens: number,
    model: string
  ): Promise<void> {
    await this.recordUsage({
      userId,
      organizationId,
      metricName: 'ai_tokens',
      value: tokens,
      timestamp: new Date(),
      metadata: { model },
    });
  }

  /**
   * Record compute time usage
   */
  async recordComputeTime(
    userId: string,
    organizationId: string,
    seconds: number,
    operation: string
  ): Promise<void> {
    await this.recordUsage({
      userId,
      organizationId,
      metricName: 'compute_seconds',
      value: seconds,
      timestamp: new Date(),
      metadata: { operation },
    });
  }

  /**
   * Get usage summary for period
   */
  async getUsageSummary(
    organizationId: string,
    period: { start: Date; end: Date }
  ): Promise<UsageSummary> {
    const metrics = new Map<string, MetricUsage>();
    let totalCost = 0;

    // Get organization tier
    const org = await this.getOrganization(organizationId);
    const tier = org.tier || 'free';

    // Calculate usage for each metric
    for (const [key, metric] of Object.entries(USAGE_METRICS)) {
      const usage = await this.getMetricUsage(
        organizationId,
        metric.name,
        period.start,
        period.end
      );

      const includedQuantity = metric.includedInTier[tier] || 0;
      const billableQuantity = Math.max(0, usage - includedQuantity);
      const cost = billableQuantity * metric.pricePerUnit;

      metrics.set(metric.name, {
        metric: metric.name,
        quantity: usage,
        includedQuantity,
        billableQuantity,
        unitPrice: metric.pricePerUnit,
        totalCost: cost,
      });

      totalCost += cost;
    }

    return {
      userId: '', // Organization-level
      organizationId,
      period,
      metrics,
      totalCost: Math.round(totalCost), // Round to cents
      creditsUsed: 0,
      overage: Math.max(0, totalCost),
    };
  }

  /**
   * Calculate current month bill
   */
  async calculateCurrentBill(organizationId: string): Promise<number> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const summary = await this.getUsageSummary(organizationId, { start, end });
    return summary.totalCost;
  }

  /**
   * Check if organization has exceeded limits
   */
  async checkUsageLimits(organizationId: string): Promise<{
    withinLimits: boolean;
    exceeded: string[];
    usage: Record<string, number>;
  }> {
    const org = await this.getOrganization(organizationId);
    const tier = org.tier || 'free';

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);

    const exceeded: string[] = [];
    const usage: Record<string, number> = {};

    for (const [key, metric] of Object.entries(USAGE_METRICS)) {
      const currentUsage = await this.getMetricUsage(
        organizationId,
        metric.name,
        start,
        now
      );

      usage[metric.name] = currentUsage;

      const limit = metric.includedInTier[tier];
      if (currentUsage > limit) {
        exceeded.push(metric.name);
      }
    }

    return {
      withinLimits: exceeded.length === 0,
      exceeded,
      usage,
    };
  }

  /**
   * Create invoice for usage
   */
  async createUsageInvoice(
    organizationId: string,
    period: { start: Date; end: Date }
  ): Promise<string> {
    const summary = await this.getUsageSummary(organizationId, period);

    if (summary.totalCost === 0) {
      logger.info('No usage charges for period', { organizationId, period });
      return '';
    }

    const org = await this.getOrganization(organizationId);

    // Create Stripe invoice
    const invoice = await stripe.invoices.create({
      customer: org.stripeCustomerId,
      auto_advance: true,
      collection_method: 'charge_automatically',
      description: `Usage charges for ${period.start.toISOString().slice(0, 7)}`,
      metadata: {
        organizationId,
        period_start: period.start.toISOString(),
        period_end: period.end.toISOString(),
      },
    });

    // Add line items for each metric
    for (const [metricName, metricUsage] of summary.metrics) {
      if (metricUsage.billableQuantity > 0) {
        await stripe.invoiceItems.create({
          customer: org.stripeCustomerId,
          invoice: invoice.id,
          amount: metricUsage.totalCost,
          currency: 'usd',
          description: `${metricName}: ${metricUsage.billableQuantity} ${USAGE_METRICS[metricName.toUpperCase()]?.unit || 'units'}`,
          metadata: {
            metric: metricName,
            quantity: metricUsage.billableQuantity.toString(),
            unit_price: metricUsage.unitPrice.toString(),
          },
        });
      }
    }

    // Finalize invoice
    await stripe.invoices.finalizeInvoice(invoice.id);

    logger.info('Created usage invoice', {
      organizationId,
      invoiceId: invoice.id,
      amount: summary.totalCost,
    });

    return invoice.id;
  }

  /**
   * Send event to Stripe Billing Meter
   */
  private async sendToStripeMeter(event: MeterEvent): Promise<void> {
    try {
      // Stripe Billing Meters API
      // This is a newer feature - adjust based on Stripe API version
      const meterEventName = `${event.metricName}_${event.organizationId}`;

      // In production, you'd use Stripe's actual metering API
      logger.debug('Sending to Stripe meter', {
        event: meterEventName,
        value: event.value,
      });
    } catch (error) {
      logger.error('Failed to send to Stripe meter', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Flush buffered events to database
   */
  private async flushEvents(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      // Batch insert to database
      const stmt = this.db.prepare(`
        INSERT INTO usage_events
        (user_id, organization_id, metric_name, value, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const insertMany = this.db.transaction(() => {
        for (const event of events) {
          stmt.run(
            event.userId,
            event.organizationId,
            event.metricName,
            event.value,
            event.timestamp.toISOString(),
            JSON.stringify(event.metadata || {})
          );
        }
      });

      insertMany();

      logger.debug('Flushed usage events', { count: events.length });
    } catch (error) {
      logger.error('Failed to flush usage events', error instanceof Error ? error : undefined);
      // Re-add to buffer
      this.eventBuffer.unshift(...events);
    }
  }

  /**
   * Start background flush timer
   */
  private startBackgroundFlush(): void {
    setInterval(async () => {
      await this.flushEvents();
    }, this.flushInterval);
  }

  /**
   * Get metric usage for period
   */
  private async getMetricUsage(
    organizationId: string,
    metricName: string,
    start: Date,
    end: Date
  ): Promise<number> {
    const result = this.db
      .prepare(
        `
        SELECT SUM(value) as total
        FROM usage_events
        WHERE organization_id = ?
          AND metric_name = ?
          AND timestamp >= ?
          AND timestamp <= ?
      `
      )
      .get(
        organizationId,
        metricName,
        start.toISOString(),
        end.toISOString()
      ) as { total: number | null };

    return result?.total || 0;
  }

  /**
   * Get organization details
   */
  private async getOrganization(organizationId: string): Promise<any> {
    // In real implementation, fetch from organizations table
    return {
      id: organizationId,
      tier: 'pro',
      stripeCustomerId: 'cus_test',
    };
  }
}

// Singleton
let meteredBilling: MeteredBillingEngine;

export function getMeteredBilling(): MeteredBillingEngine {
  if (!meteredBilling) {
    meteredBilling = new MeteredBillingEngine();
  }
  return meteredBilling;
}

// Middleware to automatically track API usage
export function meteringMiddleware() {
  return async (req: any, res: any, next: any) => {
    const startTime = Date.now();

    // Extract user/org from request
    const userId = req.user?.id || 'anonymous';
    const organizationId = req.user?.organizationId || req.headers['x-organization-id'] || 'default';

    // Track API request
    const billing = getMeteredBilling();
    await billing.recordAPIRequest(userId, organizationId, req.path);

    // Track response time as compute
    res.on('finish', async () => {
      const duration = (Date.now() - startTime) / 1000;
      await billing.recordComputeTime(userId, organizationId, duration, req.path);
    });

    next();
  };
}

// Helper to track AI token usage
export async function trackAIUsage(
  userId: string,
  organizationId: string,
  inputTokens: number,
  outputTokens: number,
  model: string
): Promise<void> {
  const billing = getMeteredBilling();
  const totalTokens = inputTokens + outputTokens;
  await billing.recordAITokens(userId, organizationId, totalTokens, model);
}
