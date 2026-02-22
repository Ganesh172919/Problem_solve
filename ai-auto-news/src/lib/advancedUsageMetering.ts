/**
 * Advanced Usage Metering & Attribution System
 *
 * Granular tracking of resource consumption for:
 * - API calls
 * - Compute time
 * - Token usage
 * - Storage
 * - Bandwidth
 * - Feature usage
 *
 * Supports real-time metering, aggregation, and billing attribution.
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export interface UsageEvent {
  id: string;
  userId: string;
  apiKeyId?: string;
  timestamp: Date;
  resourceType: ResourceType;
  quantity: number;
  unit: string;
  metadata: UsageMetadata;
  cost?: number;
  tier: string;
}

export type ResourceType =
  | 'api_call'
  | 'compute_time'
  | 'tokens'
  | 'storage'
  | 'bandwidth'
  | 'feature_access'
  | 'ai_generation'
  | 'search_query'
  | 'webhook_delivery';

export interface UsageMetadata {
  endpoint?: string;
  method?: string;
  duration?: number;
  statusCode?: number;
  feature?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  requestSize?: number;
  responseSize?: number;
  region?: string;
}

export interface UsageQuota {
  resourceType: ResourceType;
  tier: string;
  period: 'minute' | 'hour' | 'day' | 'month';
  limit: number;
  softLimit?: number; // Warning threshold
  resetTime: Date;
}

export interface UsageAggregate {
  userId: string;
  period: { start: Date; end: Date };
  byResource: Map<ResourceType, ResourceUsage>;
  totalCost: number;
  quotaStatus: Map<ResourceType, QuotaStatus>;
}

export interface ResourceUsage {
  resourceType: ResourceType;
  totalQuantity: number;
  totalCost: number;
  events: number;
  breakdown: Map<string, number>; // e.g., by endpoint, by model
  trend: 'increasing' | 'decreasing' | 'stable';
  projectedUsage: number; // Estimated usage by end of period
}

export interface QuotaStatus {
  resourceType: ResourceType;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  resetTime: Date;
  exceeded: boolean;
  nearLimit: boolean; // Within 80% of limit
}

export interface BillingAttribution {
  userId: string;
  period: { start: Date; end: Date };
  lineItems: BillingLineItem[];
  subtotal: number;
  discounts: Discount[];
  credits: Credit[];
  total: number;
}

export interface BillingLineItem {
  description: string;
  resourceType: ResourceType;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  details: Record<string, any>;
}

export interface Discount {
  type: 'volume' | 'promotional' | 'loyalty' | 'custom';
  description: string;
  amount: number;
  percentage?: number;
}

export interface Credit {
  id: string;
  description: string;
  amount: number;
  remaining: number;
  expiresAt?: Date;
}

export interface CostAllocationRule {
  id: string;
  resourceType: ResourceType;
  pricingModel: 'flat' | 'tiered' | 'volume' | 'dynamic';
  pricing: PricingTier[];
  minimumCharge?: number;
  includedQuota?: number; // Free tier included in subscription
}

export interface PricingTier {
  from: number;
  to?: number;
  price: number; // Price per unit
  flatFee?: number;
}

class AdvancedUsageMeteringSystem {
  private events: UsageEvent[] = [];
  private quotas: Map<string, UsageQuota[]> = new Map();
  private costRules: Map<ResourceType, CostAllocationRule> = new Map();
  private cache = getCache();
  private readonly MAX_EVENTS_IN_MEMORY = 10000;

  constructor() {
    this.initializeCostRules();
  }

  /**
   * Record usage event
   */
  async recordUsage(event: Omit<UsageEvent, 'id' | 'timestamp' | 'cost'>): Promise<void> {
    const usageEvent: UsageEvent = {
      ...event,
      id: `usage_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date(),
      cost: await this.calculateCost(event.resourceType, event.quantity, event.tier),
    };

    // Store event
    this.events.push(usageEvent);

    // Trim old events if necessary
    if (this.events.length > this.MAX_EVENTS_IN_MEMORY) {
      this.events = this.events.slice(-this.MAX_EVENTS_IN_MEMORY);
    }

    // Update real-time counters in cache
    await this.updateRealTimeCounters(usageEvent);

    // Check quotas
    await this.checkQuotas(event.userId, event.resourceType);

    logger.debug('Usage recorded', {
      userId: event.userId,
      resourceType: event.resourceType,
      quantity: event.quantity,
      cost: usageEvent.cost,
    });
  }

  /**
   * Get current usage for user
   */
  async getUsage(
    userId: string,
    period: { start: Date; end: Date }
  ): Promise<UsageAggregate> {
    const userEvents = this.events.filter(
      e =>
        e.userId === userId &&
        e.timestamp >= period.start &&
        e.timestamp <= period.end
    );

    const byResource = new Map<ResourceType, ResourceUsage>();
    let totalCost = 0;

    // Group by resource type
    const resourceGroups = this.groupByResource(userEvents);

    for (const [resourceType, events] of resourceGroups.entries()) {
      const totalQuantity = events.reduce((sum, e) => sum + e.quantity, 0);
      const resourceCost = events.reduce((sum, e) => sum + (e.cost || 0), 0);

      // Calculate breakdown
      const breakdown = new Map<string, number>();
      for (const event of events) {
        const key = event.metadata.endpoint || event.metadata.feature || 'other';
        breakdown.set(key, (breakdown.get(key) || 0) + event.quantity);
      }

      // Calculate trend
      const trend = this.calculateTrend(events, period);

      // Project usage
      const elapsed = Date.now() - period.start.getTime();
      const total = period.end.getTime() - period.start.getTime();
      const projectedUsage = total > 0 ? (totalQuantity / elapsed) * total : totalQuantity;

      byResource.set(resourceType, {
        resourceType,
        totalQuantity,
        totalCost: resourceCost,
        events: events.length,
        breakdown,
        trend,
        projectedUsage,
      });

      totalCost += resourceCost;
    }

    // Get quota status
    const quotaStatus = await this.getQuotaStatus(userId);

    return {
      userId,
      period,
      byResource,
      totalCost,
      quotaStatus,
    };
  }

  /**
   * Generate billing attribution
   */
  async generateBilling(
    userId: string,
    period: { start: Date; end: Date }
  ): Promise<BillingAttribution> {
    const usage = await this.getUsage(userId, period);

    const lineItems: BillingLineItem[] = [];

    for (const [resourceType, resourceUsage] of usage.byResource.entries()) {
      const rule = this.costRules.get(resourceType);
      if (!rule) continue;

      // Apply included quota
      let billableQuantity = resourceUsage.totalQuantity;
      if (rule.includedQuota) {
        billableQuantity = Math.max(0, billableQuantity - rule.includedQuota);
      }

      if (billableQuantity > 0) {
        lineItems.push({
          description: this.getResourceDescription(resourceType),
          resourceType,
          quantity: billableQuantity,
          unit: this.getResourceUnit(resourceType),
          unitPrice: await this.getUnitPrice(resourceType, billableQuantity),
          amount: resourceUsage.totalCost,
          details: Object.fromEntries(resourceUsage.breakdown),
        });
      }
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);

    // Apply discounts
    const discounts = await this.calculateDiscounts(userId, subtotal, usage);

    // Get available credits
    const credits = await this.getAvailableCredits(userId);

    // Calculate total
    const discountAmount = discounts.reduce((sum, d) => sum + d.amount, 0);
    const creditAmount = Math.min(
      credits.reduce((sum, c) => sum + c.remaining, 0),
      subtotal - discountAmount
    );

    const total = Math.max(0, subtotal - discountAmount - creditAmount);

    return {
      userId,
      period,
      lineItems,
      subtotal,
      discounts,
      credits,
      total,
    };
  }

  /**
   * Set quota for user
   */
  async setQuota(userId: string, quota: UsageQuota): Promise<void> {
    if (!this.quotas.has(userId)) {
      this.quotas.set(userId, []);
    }

    const userQuotas = this.quotas.get(userId)!;
    const existingIndex = userQuotas.findIndex(
      q => q.resourceType === quota.resourceType && q.period === quota.period
    );

    if (existingIndex >= 0) {
      userQuotas[existingIndex] = quota;
    } else {
      userQuotas.push(quota);
    }

    logger.info('Quota set', {
      userId,
      resourceType: quota.resourceType,
      limit: quota.limit,
      period: quota.period,
    });
  }

  /**
   * Check if user is within quota
   */
  async checkQuota(userId: string, resourceType: ResourceType): Promise<QuotaStatus | null> {
    const quotaStatuses = await this.getQuotaStatus(userId);
    return quotaStatuses.get(resourceType) || null;
  }

  /**
   * Get detailed usage breakdown
   */
  async getUsageBreakdown(
    userId: string,
    resourceType: ResourceType,
    groupBy: 'hour' | 'day' | 'endpoint' | 'feature'
  ): Promise<Map<string, number>> {
    const breakdown = new Map<string, number>();

    const userEvents = this.events.filter(
      e => e.userId === userId && e.resourceType === resourceType
    );

    for (const event of userEvents) {
      let key: string;

      switch (groupBy) {
        case 'hour':
          key = event.timestamp.toISOString().substring(0, 13);
          break;
        case 'day':
          key = event.timestamp.toISOString().substring(0, 10);
          break;
        case 'endpoint':
          key = event.metadata.endpoint || 'unknown';
          break;
        case 'feature':
          key = event.metadata.feature || 'unknown';
          break;
        default:
          key = 'unknown';
      }

      breakdown.set(key, (breakdown.get(key) || 0) + event.quantity);
    }

    return breakdown;
  }

  /**
   * Stream usage events in real-time
   */
  async *streamUsage(userId: string): AsyncGenerator<UsageEvent> {
    let lastIndex = 0;

    while (true) {
      // Find new events for this user
      while (lastIndex < this.events.length) {
        const event = this.events[lastIndex];
        if (event.userId === userId) {
          yield event;
        }
        lastIndex++;
      }

      // Wait before checking for more events
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Private helper methods

  private initializeCostRules(): void {
    // API Calls
    this.costRules.set('api_call', {
      id: 'api_call_pricing',
      resourceType: 'api_call',
      pricingModel: 'tiered',
      pricing: [
        { from: 0, to: 1000, price: 0 }, // Free tier
        { from: 1001, to: 10000, price: 0.001 },
        { from: 10001, to: 100000, price: 0.0008 },
        { from: 100001, price: 0.0005 },
      ],
    });

    // Tokens
    this.costRules.set('tokens', {
      id: 'token_pricing',
      resourceType: 'tokens',
      pricingModel: 'flat',
      pricing: [{ from: 0, price: 0.00002 }], // $0.02 per 1000 tokens
    });

    // Compute time
    this.costRules.set('compute_time', {
      id: 'compute_pricing',
      resourceType: 'compute_time',
      pricingModel: 'flat',
      pricing: [{ from: 0, price: 0.0001 }], // $0.0001 per second
    });

    // Storage
    this.costRules.set('storage', {
      id: 'storage_pricing',
      resourceType: 'storage',
      pricingModel: 'flat',
      pricing: [{ from: 0, price: 0.00001 }], // $0.01 per GB-hour
    });

    // Bandwidth
    this.costRules.set('bandwidth', {
      id: 'bandwidth_pricing',
      resourceType: 'bandwidth',
      pricingModel: 'tiered',
      pricing: [
        { from: 0, to: 10, price: 0 }, // First 10GB free
        { from: 11, to: 100, price: 0.1 },
        { from: 101, price: 0.05 },
      ],
    });
  }

  private async calculateCost(
    resourceType: ResourceType,
    quantity: number,
    tier: string
  ): Promise<number> {
    const rule = this.costRules.get(resourceType);
    if (!rule) return 0;

    let cost = 0;

    switch (rule.pricingModel) {
      case 'flat':
        cost = quantity * rule.pricing[0].price;
        break;

      case 'tiered':
        let remaining = quantity;
        for (const tier of rule.pricing) {
          if (remaining <= 0) break;

          const tierSize = tier.to ? tier.to - tier.from + 1 : Infinity;
          const quantityInTier = Math.min(remaining, tierSize);

          cost += quantityInTier * tier.price;
          remaining -= quantityInTier;
        }
        break;

      case 'volume':
        // Find applicable tier
        const applicableTier = rule.pricing
          .filter(t => quantity >= t.from && (!t.to || quantity <= t.to))
          .pop();
        if (applicableTier) {
          cost = quantity * applicableTier.price;
        }
        break;
    }

    // Apply minimum charge
    if (rule.minimumCharge && cost > 0) {
      cost = Math.max(cost, rule.minimumCharge);
    }

    return cost;
  }

  private async updateRealTimeCounters(event: UsageEvent): Promise<void> {
    const key = `usage:${event.userId}:${event.resourceType}:minute`;
    const current = (await this.cache.get(key)) || 0;
    await this.cache.set(key, current + event.quantity, 60); // 60s TTL
  }

  private async checkQuotas(userId: string, resourceType: ResourceType): Promise<void> {
    const quotaStatus = await this.checkQuota(userId, resourceType);

    if (quotaStatus) {
      if (quotaStatus.exceeded) {
        logger.warn('Quota exceeded', {
          userId,
          resourceType,
          used: quotaStatus.used,
          limit: quotaStatus.limit,
        });
      } else if (quotaStatus.nearLimit) {
        logger.info('Approaching quota limit', {
          userId,
          resourceType,
          percentUsed: quotaStatus.percentUsed,
        });
      }
    }
  }

  private async getQuotaStatus(userId: string): Promise<Map<ResourceType, QuotaStatus>> {
    const statusMap = new Map<ResourceType, QuotaStatus>();
    const userQuotas = this.quotas.get(userId) || [];

    for (const quota of userQuotas) {
      const used = await this.getUsageInPeriod(
        userId,
        quota.resourceType,
        quota.period,
        quota.resetTime
      );

      const remaining = Math.max(0, quota.limit - used);
      const percentUsed = (used / quota.limit) * 100;

      statusMap.set(quota.resourceType, {
        resourceType: quota.resourceType,
        used,
        limit: quota.limit,
        remaining,
        percentUsed,
        resetTime: quota.resetTime,
        exceeded: used >= quota.limit,
        nearLimit: percentUsed >= 80,
      });
    }

    return statusMap;
  }

  private async getUsageInPeriod(
    userId: string,
    resourceType: ResourceType,
    period: 'minute' | 'hour' | 'day' | 'month',
    since: Date
  ): Promise<number> {
    const events = this.events.filter(
      e =>
        e.userId === userId &&
        e.resourceType === resourceType &&
        e.timestamp >= since
    );

    return events.reduce((sum, e) => sum + e.quantity, 0);
  }

  private groupByResource(events: UsageEvent[]): Map<ResourceType, UsageEvent[]> {
    const groups = new Map<ResourceType, UsageEvent[]>();

    for (const event of events) {
      if (!groups.has(event.resourceType)) {
        groups.set(event.resourceType, []);
      }
      groups.get(event.resourceType)!.push(event);
    }

    return groups;
  }

  private calculateTrend(
    events: UsageEvent[],
    period: { start: Date; end: Date }
  ): 'increasing' | 'decreasing' | 'stable' {
    if (events.length < 2) return 'stable';

    // Split into two halves
    const sorted = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const midpoint = Math.floor(sorted.length / 2);

    const firstHalf = sorted.slice(0, midpoint);
    const secondHalf = sorted.slice(midpoint);

    const firstAvg = firstHalf.reduce((sum, e) => sum + e.quantity, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, e) => sum + e.quantity, 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / firstAvg;

    if (change > 0.2) return 'increasing';
    if (change < -0.2) return 'decreasing';
    return 'stable';
  }

  private async calculateDiscounts(
    userId: string,
    subtotal: number,
    usage: UsageAggregate
  ): Promise<Discount[]> {
    const discounts: Discount[] = [];

    // Volume discount (> $1000)
    if (subtotal > 1000) {
      const discountPercentage = Math.min(20, Math.floor((subtotal - 1000) / 1000) * 5);
      discounts.push({
        type: 'volume',
        description: `${discountPercentage}% volume discount`,
        amount: subtotal * (discountPercentage / 100),
        percentage: discountPercentage,
      });
    }

    return discounts;
  }

  private async getAvailableCredits(userId: string): Promise<Credit[]> {
    // Would fetch from database
    return [];
  }

  private getResourceDescription(resourceType: ResourceType): string {
    const descriptions: Record<ResourceType, string> = {
      api_call: 'API Calls',
      compute_time: 'Compute Time',
      tokens: 'AI Tokens',
      storage: 'Storage',
      bandwidth: 'Bandwidth',
      feature_access: 'Feature Access',
      ai_generation: 'AI Content Generation',
      search_query: 'Search Queries',
      webhook_delivery: 'Webhook Deliveries',
    };

    return descriptions[resourceType] || resourceType;
  }

  private getResourceUnit(resourceType: ResourceType): string {
    const units: Record<ResourceType, string> = {
      api_call: 'calls',
      compute_time: 'seconds',
      tokens: 'tokens',
      storage: 'GB-hours',
      bandwidth: 'GB',
      feature_access: 'accesses',
      ai_generation: 'generations',
      search_query: 'queries',
      webhook_delivery: 'deliveries',
    };

    return units[resourceType] || 'units';
  }

  private async getUnitPrice(resourceType: ResourceType, quantity: number): Promise<number> {
    const cost = await this.calculateCost(resourceType, quantity, 'pro');
    return quantity > 0 ? cost / quantity : 0;
  }

  /**
   * Get system statistics
   */
  getStats(): {
    totalEvents: number;
    totalUsers: number;
    totalCost: number;
    eventsByResource: Map<ResourceType, number>;
  } {
    const users = new Set(this.events.map(e => e.userId));
    const totalCost = this.events.reduce((sum, e) => sum + (e.cost || 0), 0);

    const eventsByResource = new Map<ResourceType, number>();
    for (const event of this.events) {
      eventsByResource.set(
        event.resourceType,
        (eventsByResource.get(event.resourceType) || 0) + 1
      );
    }

    return {
      totalEvents: this.events.length,
      totalUsers: users.size,
      totalCost,
      eventsByResource,
    };
  }
}

// Singleton
let meteringSystem: AdvancedUsageMeteringSystem;

export function getUsageMeteringSystem(): AdvancedUsageMeteringSystem {
  if (!meteringSystem) {
    meteringSystem = new AdvancedUsageMeteringSystem();
  }
  return meteringSystem;
}
