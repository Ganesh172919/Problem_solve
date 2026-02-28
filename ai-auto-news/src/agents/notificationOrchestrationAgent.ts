/**
 * @module notificationOrchestrationAgent
 * @description Autonomous agent that monitors notification delivery health, retries failed
 * deliveries with exponential backoff, prunes stale suppression entries, and generates
 * per-tenant delivery reports using the MultiChannelNotificationOrchestrator engine.
 */

import { getMultiChannelNotificationOrchestrator, ChannelDeliveryStats, NotificationChannel } from '../lib/multiChannelNotificationOrchestrator';
import { getLogger } from '../lib/logger';

const logger = getLogger();

class NotificationOrchestrationAgent {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly scanIntervalMs: number;
  /** tenantId -> delivery IDs tracked for retry management */
  private readonly tenantDeliveries = new Map<string, string[]>();
  /** tenantId -> suppression entries tracked for pruning */
  private readonly suppressionRegistry = new Map<string, Array<{ userId: string; channel: NotificationChannel; suppressedAt: number }>>();

  constructor(scanIntervalMs = 5 * 60 * 1000) {
    this.scanIntervalMs = scanIntervalMs;
  }

  start(): void {
    if (this.interval) return;
    logger.info('NotificationOrchestrationAgent starting');
    this.interval = setInterval(() => this._runScan(), this.scanIntervalMs);
    this._runScan();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('NotificationOrchestrationAgent stopped');
    }
  }

  /**
   * Register a delivery ID under a tenant for retry tracking.
   */
  trackDelivery(tenantId: string, deliveryId: string): void {
    const list = this.tenantDeliveries.get(tenantId) ?? [];
    list.push(deliveryId);
    this.tenantDeliveries.set(tenantId, list);
  }

  /**
   * Record a suppression entry in the agent's local registry for future pruning.
   */
  trackSuppression(tenantId: string, userId: string, channel: NotificationChannel): void {
    const list = this.suppressionRegistry.get(tenantId) ?? [];
    list.push({ userId, channel, suppressedAt: Date.now() });
    this.suppressionRegistry.set(tenantId, list);
  }

  private _runScan(): void {
    try {
      const orchestrator = getMultiChannelNotificationOrchestrator();
      const summary = orchestrator.getSummary();
      const totalFailed = Object.values(summary.statsByChannel)
        .reduce((s, c) => s + (c?.totalFailed ?? 0), 0);
      const report = {
        totalDeliveries: summary.totalDeliveries,
        pendingRetries: summary.pendingRetries,
        failedDeliveries: totalFailed,
        deliveryRateOverall: summary.deliveryRateOverall,
        suppressedRecipients: summary.suppressedRecipients,
        activeTemplates: summary.activeTemplates,
        topEngagingChannels: summary.topEngagingChannels,
      };
      logger.debug('NotificationOrchestrationAgent scan complete', report);
    } catch (err) {
      logger.error('NotificationOrchestrationAgent scan error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Attempt to retry all failed deliveries tracked under a tenant,
   * logging the count retried and count that reached delivered status.
   */
  retryFailedDeliveries(tenantId: string): { retried: number; succeeded: number } {
    const orchestrator = getMultiChannelNotificationOrchestrator();
    const deliveryIds = this.tenantDeliveries.get(tenantId) ?? [];
    let retried = 0;
    let succeeded = 0;

    for (const deliveryId of deliveryIds) {
      try {
        const result = orchestrator.retryFailed(deliveryId);
        if (result.status === 'sending' || result.status === 'delivered') {
          retried++;
          if (result.status === 'delivered') succeeded++;
        }
      } catch {
        // delivery not found or not in a retriable state — skip
      }
    }

    logger.info('NotificationOrchestrationAgent retry sweep', {
      tenantId,
      evaluated: deliveryIds.length,
      retried,
      succeeded,
    });
    return { retried, succeeded };
  }

  /**
   * Remove suppression entries older than maxAgeDays from the agent's local registry.
   * For each stale entry, a replacement suppression with a 1-second expiry is pushed to
   * the orchestrator so its internal suppression check clears on the next evaluation.
   */
  pruneSuppressionList(tenantId: string, maxAgeDays: number): { pruned: number } {
    const orchestrator = getMultiChannelNotificationOrchestrator();
    const list = this.suppressionRegistry.get(tenantId) ?? [];
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const stale = list.filter(e => e.suppressedAt < cutoff);
    const active = list.filter(e => e.suppressedAt >= cutoff);

    for (const entry of stale) {
      // Push a near-expired suppression so the orchestrator's expiry check will clear it
      orchestrator.suppressRecipient(entry.userId, tenantId, entry.channel, 'manual', 1000);
    }

    this.suppressionRegistry.set(tenantId, active);
    logger.info('NotificationOrchestrationAgent suppression prune', {
      tenantId,
      maxAgeDays,
      pruned: stale.length,
      remaining: active.length,
    });
    return { pruned: stale.length };
  }

  /**
   * Retrieve per-channel delivery statistics for a tenant and return a formatted report.
   */
  generateDeliveryReport(tenantId: string): {
    tenantId: string;
    generatedAt: string;
    channelStats: ChannelDeliveryStats[];
    summary: { totalSent: number; totalDelivered: number; totalFailed: number; overallDeliveryRate: number };
  } {
    const orchestrator = getMultiChannelNotificationOrchestrator();
    const channelStats = orchestrator.getDeliveryStats(tenantId);
    const totalSent = channelStats.reduce((s, c) => s + c.totalSent, 0);
    const totalDelivered = channelStats.reduce((s, c) => s + c.totalDelivered, 0);
    const totalFailed = channelStats.reduce((s, c) => s + c.totalFailed, 0);
    const overallDeliveryRate = totalSent > 0 ? parseFloat((totalDelivered / totalSent).toFixed(4)) : 0;

    const report = {
      tenantId,
      generatedAt: new Date().toISOString(),
      channelStats,
      summary: { totalSent, totalDelivered, totalFailed, overallDeliveryRate },
    };
    logger.info('NotificationOrchestrationAgent delivery report', {
      tenantId,
      totalSent,
      totalDelivered,
      totalFailed,
      overallDeliveryRate,
    });
    return report;
  }
}

const KEY = '__notificationOrchestrationAgent__';
export function getNotificationOrchestrationAgent(): NotificationOrchestrationAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new NotificationOrchestrationAgent();
  }
  return (globalThis as Record<string, unknown>)[KEY] as NotificationOrchestrationAgent;
}
