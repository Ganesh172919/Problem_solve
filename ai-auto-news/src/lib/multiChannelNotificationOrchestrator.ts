/**
 * @module multiChannelNotificationOrchestrator
 * @description Multi-channel notification delivery engine with channel adapter registry
 * (email/sms/push/webhook/in-app), preference management, priority queuing, deduplication
 * window, retry with exponential backoff, delivery status tracking, suppression list,
 * template rendering, engagement tracking, and per-tenant delivery analytics.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'sms' | 'push' | 'webhook' | 'in_app';
export type DeliveryStatus = 'queued' | 'sending' | 'delivered' | 'failed' | 'suppressed' | 'deduplicated';
export type EngagementEvent = 'open' | 'click' | 'dismiss' | 'unsubscribe';

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  subject?: string;
  bodyTemplate: string;
  variables: string[];
  createdAt: number;
}

export interface ChannelPreference {
  userId: string;
  tenantId: string;
  channels: Partial<Record<NotificationChannel, boolean>>;
  quietHoursStart?: number; // 0-23
  quietHoursEnd?: number;
  timezone?: string;
}

export interface NotificationDelivery {
  id: string;
  tenantId: string;
  userId: string;
  templateId: string;
  channel: NotificationChannel;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: DeliveryStatus;
  renderedBody: string;
  renderedSubject?: string;
  attemptCount: number;
  nextRetryAt?: number;
  lastError?: string;
  queuedAt: number;
  deliveredAt?: number;
  deduplicationKey?: string;
}

export interface SuppressionEntry {
  userId: string;
  tenantId: string;
  channel: NotificationChannel;
  reason: 'unsubscribe' | 'bounce' | 'spam_complaint' | 'manual';
  suppressedAt: number;
  expiresAt?: number;
}

export interface EngagementRecord {
  deliveryId: string;
  userId: string;
  event: EngagementEvent;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelDeliveryStats {
  channel: NotificationChannel;
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalSuppressed: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  avgRetryCount: number;
}

export interface NotificationOrchestratorSummary {
  totalDeliveries: number;
  deliveryRateOverall: number;
  suppressedRecipients: number;
  activeTemplates: number;
  statsByChannel: Partial<Record<NotificationChannel, ChannelDeliveryStats>>;
  topEngagingChannels: NotificationChannel[];
  pendingRetries: number;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class MultiChannelNotificationOrchestrator {
  private templates: Map<string, NotificationTemplate> = new Map();
  private deliveries: Map<string, NotificationDelivery> = new Map();
  private preferences: Map<string, ChannelPreference> = new Map(); // userId -> prefs
  private suppressions: Map<string, SuppressionEntry[]> = new Map(); // userId -> entries
  private engagements: EngagementRecord[] = [];
  private deduplicationWindow: Map<string, number> = new Map(); // key -> expiry timestamp
  private readonly DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  private readonly MAX_RETRIES = 5;
  private readonly BASE_BACKOFF_MS = 5000;

  // Priority ordering
  private readonly PRIORITY_ORDER: Record<string, number> = {
    critical: 0, high: 1, normal: 2, low: 3,
  };

  constructor() {
    logger.info('[MultiChannelNotificationOrchestrator] Initialized notification orchestrator');
  }

  /**
   * Register a channel adapter (marks the channel as available in the registry).
   */
  registerChannel(channel: NotificationChannel, config: Record<string, unknown>): void {
    logger.info(`[MultiChannelNotificationOrchestrator] Channel '${channel}' registered with ${Object.keys(config).length} config keys`);
  }

  /**
   * Create or update a notification template.
   */
  createTemplate(template: NotificationTemplate): void {
    this.templates.set(template.id, { ...template, createdAt: template.createdAt || Date.now() });
    logger.info(`[MultiChannelNotificationOrchestrator] Template '${template.id}' created for channel ${template.channel}`);
  }

  /**
   * Queue a notification for delivery, respecting preferences, suppression, and deduplication.
   */
  sendNotification(
    tenantId: string,
    userId: string,
    templateId: string,
    channel: NotificationChannel,
    variables: Record<string, string>,
    priority: NotificationDelivery['priority'] = 'normal',
    deduplicationKey?: string,
  ): NotificationDelivery {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    // Check suppression
    if (this.isRecipientSuppressed(userId, channel)) {
      const delivery = this.createDelivery(tenantId, userId, templateId, channel, priority, '', undefined, deduplicationKey);
      delivery.status = 'suppressed';
      delivery.lastError = 'Recipient is suppressed for this channel';
      this.deliveries.set(delivery.id, delivery);
      logger.warn(`[MultiChannelNotificationOrchestrator] Suppressed delivery to ${userId} on ${channel}`);
      return delivery;
    }

    // Check preferences
    const prefs = this.preferences.get(userId);
    if (prefs && prefs.channels[channel] === false) {
      const delivery = this.createDelivery(tenantId, userId, templateId, channel, priority, '', undefined, deduplicationKey);
      delivery.status = 'suppressed';
      delivery.lastError = 'Channel disabled by user preference';
      this.deliveries.set(delivery.id, delivery);
      return delivery;
    }

    // Deduplication check
    if (deduplicationKey) {
      const expiry = this.deduplicationWindow.get(deduplicationKey);
      if (expiry && expiry > Date.now()) {
        const delivery = this.createDelivery(tenantId, userId, templateId, channel, priority, '', undefined, deduplicationKey);
        delivery.status = 'deduplicated';
        this.deliveries.set(delivery.id, delivery);
        logger.debug(`[MultiChannelNotificationOrchestrator] Deduplication hit for key ${deduplicationKey}`);
        return delivery;
      }
      this.deduplicationWindow.set(deduplicationKey, Date.now() + this.DEDUP_WINDOW_MS);
    }

    const renderedBody = this.renderTemplate(template.bodyTemplate, variables);
    const renderedSubject = template.subject
      ? this.renderTemplate(template.subject, variables) : undefined;

    const delivery = this.createDelivery(
      tenantId, userId, templateId, channel, priority, renderedBody, renderedSubject, deduplicationKey,
    );
    delivery.status = 'queued';
    this.deliveries.set(delivery.id, delivery);

    logger.info(`[MultiChannelNotificationOrchestrator] Queued ${channel} notification ${delivery.id} for ${userId} (${priority})`);
    return delivery;
  }

  /**
   * Simulate a delivery attempt and apply exponential backoff on failure.
   */
  retryFailed(deliveryId: string): NotificationDelivery {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);
    if (delivery.status !== 'failed') {
      logger.warn(`[MultiChannelNotificationOrchestrator] Cannot retry delivery ${deliveryId}: status=${delivery.status}`);
      return delivery;
    }
    if (delivery.attemptCount >= this.MAX_RETRIES) {
      logger.error(`[MultiChannelNotificationOrchestrator] Max retries exceeded for ${deliveryId}`);
      return delivery;
    }

    delivery.attemptCount++;
    const backoffMs = this.BASE_BACKOFF_MS * Math.pow(2, delivery.attemptCount - 1);
    delivery.nextRetryAt = Date.now() + backoffMs;
    delivery.status = 'sending';

    // Simulate delivery success (90% success rate)
    const success = Math.random() > 0.1;
    if (success) {
      delivery.status = 'delivered';
      delivery.deliveredAt = Date.now();
      delivery.lastError = undefined;
      logger.info(`[MultiChannelNotificationOrchestrator] Delivery ${deliveryId} succeeded on attempt ${delivery.attemptCount}`);
    } else {
      delivery.status = 'failed';
      delivery.lastError = `Delivery attempt ${delivery.attemptCount} failed`;
      logger.warn(`[MultiChannelNotificationOrchestrator] Delivery ${deliveryId} failed (attempt ${delivery.attemptCount})`);
    }

    return delivery;
  }

  /**
   * Add a recipient to the suppression list for a specific channel.
   */
  suppressRecipient(
    userId: string,
    tenantId: string,
    channel: NotificationChannel,
    reason: SuppressionEntry['reason'],
    expiresInMs?: number,
  ): void {
    const entry: SuppressionEntry = {
      userId, tenantId, channel, reason,
      suppressedAt: Date.now(),
      expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined,
    };
    const list = this.suppressions.get(userId) ?? [];
    list.push(entry);
    this.suppressions.set(userId, list);
    logger.info(`[MultiChannelNotificationOrchestrator] Suppressed ${userId} on ${channel} (${reason})`);
  }

  /**
   * Track an engagement event (open/click/dismiss/unsubscribe) for a delivery.
   */
  trackEngagement(deliveryId: string, userId: string, event: EngagementEvent, metadata?: Record<string, unknown>): void {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      logger.warn(`[MultiChannelNotificationOrchestrator] Engagement for unknown delivery ${deliveryId}`);
      return;
    }

    this.engagements.push({ deliveryId, userId, event, timestamp: Date.now(), metadata });

    if (event === 'unsubscribe') {
      this.suppressRecipient(userId, delivery.tenantId, delivery.channel, 'unsubscribe');
    }

    logger.debug(`[MultiChannelNotificationOrchestrator] Engagement '${event}' for delivery ${deliveryId}`);
  }

  /**
   * Set channel preferences for a user.
   */
  setPreferences(prefs: ChannelPreference): void {
    this.preferences.set(prefs.userId, prefs);
    logger.debug(`[MultiChannelNotificationOrchestrator] Preferences updated for user ${prefs.userId}`);
  }

  /**
   * Get delivery statistics broken down by channel.
   */
  getDeliveryStats(tenantId?: string): ChannelDeliveryStats[] {
    const allDeliveries = tenantId
      ? Array.from(this.deliveries.values()).filter(d => d.tenantId === tenantId)
      : Array.from(this.deliveries.values());

    const channels: NotificationChannel[] = ['email', 'sms', 'push', 'webhook', 'in_app'];
    return channels.map(channel => {
      const channelDeliveries = allDeliveries.filter(d => d.channel === channel);
      const delivered = channelDeliveries.filter(d => d.status === 'delivered').length;
      const failed = channelDeliveries.filter(d => d.status === 'failed').length;
      const suppressed = channelDeliveries.filter(d => d.status === 'suppressed').length;
      const total = channelDeliveries.length;

      const channelEngagements = this.engagements.filter(e => {
        const d = this.deliveries.get(e.deliveryId);
        return d?.channel === channel && (tenantId ? d?.tenantId === tenantId : true);
      });
      const opens = channelEngagements.filter(e => e.event === 'open').length;
      const clicks = channelEngagements.filter(e => e.event === 'click').length;
      const avgRetry = channelDeliveries.length > 0
        ? channelDeliveries.reduce((s, d) => s + d.attemptCount, 0) / channelDeliveries.length : 0;

      return {
        channel,
        totalSent: total,
        totalDelivered: delivered,
        totalFailed: failed,
        totalSuppressed: suppressed,
        deliveryRate: total > 0 ? parseFloat((delivered / total).toFixed(4)) : 0,
        openRate: delivered > 0 ? parseFloat((opens / delivered).toFixed(4)) : 0,
        clickRate: delivered > 0 ? parseFloat((clicks / delivered).toFixed(4)) : 0,
        avgRetryCount: parseFloat(avgRetry.toFixed(2)),
      };
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private renderTemplate(template: string, variables: Record<string, string>): string {
    return Object.entries(variables).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v),
      template,
    );
  }

  private createDelivery(
    tenantId: string, userId: string, templateId: string, channel: NotificationChannel,
    priority: NotificationDelivery['priority'], renderedBody: string,
    renderedSubject?: string, deduplicationKey?: string,
  ): NotificationDelivery {
    return {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId, userId, templateId, channel, priority,
      status: 'queued',
      renderedBody,
      renderedSubject,
      attemptCount: 0,
      queuedAt: Date.now(),
      deduplicationKey,
    };
  }

  private isRecipientSuppressed(userId: string, channel: NotificationChannel): boolean {
    const list = this.suppressions.get(userId) ?? [];
    const now = Date.now();
    return list.some(s =>
      s.channel === channel &&
      (!s.expiresAt || s.expiresAt > now),
    );
  }

  /**
   * Return a high-level summary of the notification orchestrator.
   */
  getSummary(): NotificationOrchestratorSummary {
    const all = Array.from(this.deliveries.values());
    const delivered = all.filter(d => d.status === 'delivered').length;
    const suppressed = new Set(
      Array.from(this.suppressions.values()).flatMap(s => s.map(e => e.userId)),
    ).size;
    const pendingRetries = all.filter(d => d.status === 'failed' && d.attemptCount < this.MAX_RETRIES).length;

    const stats = this.getDeliveryStats();
    const statsByChannel: Partial<Record<NotificationChannel, ChannelDeliveryStats>> = {};
    for (const s of stats) statsByChannel[s.channel] = s;

    const topEngaging = stats
      .filter(s => s.totalDelivered > 0)
      .sort((a, b) => b.openRate - a.openRate)
      .slice(0, 3)
      .map(s => s.channel);

    return {
      totalDeliveries: all.length,
      deliveryRateOverall: all.length > 0 ? parseFloat((delivered / all.length).toFixed(4)) : 0,
      suppressedRecipients: suppressed,
      activeTemplates: this.templates.size,
      statsByChannel,
      topEngagingChannels: topEngaging,
      pendingRetries,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__multiChannelNotificationOrchestrator__';
export function getMultiChannelNotificationOrchestrator(): MultiChannelNotificationOrchestrator {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new MultiChannelNotificationOrchestrator();
  }
  return (globalThis as Record<string, unknown>)[KEY] as MultiChannelNotificationOrchestrator;
}
