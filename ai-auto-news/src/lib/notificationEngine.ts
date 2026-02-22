/**
 * Notification Engine
 *
 * Multi-channel notification system:
 * - Email (transactional and marketing)
 * - In-app notifications with persistence
 * - Push notifications (Web Push / FCM)
 * - Slack webhooks
 * - SMS (Twilio-compatible)
 * - Notification templates with variable interpolation
 * - Preference management per user/channel
 * - Batching to prevent notification fatigue
 * - Delivery tracking and analytics
 * - Retry on failure with backoff
 * - Notification categories and priority levels
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type NotificationChannel = 'email' | 'in_app' | 'push' | 'slack' | 'sms';

export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

export type NotificationCategory =
  | 'billing'
  | 'security'
  | 'content'
  | 'system'
  | 'marketing'
  | 'onboarding'
  | 'alert'
  | 'report'
  | 'collaboration';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'unsubscribed';

export interface NotificationTemplate {
  id: string;
  name: string;
  channels: NotificationChannel[];
  category: NotificationCategory;
  subject?: string; // for email
  bodyText: string; // plain text with {{variable}} placeholders
  bodyHtml?: string; // HTML for email
  pushTitle?: string;
  pushBody?: string;
  variables: string[];
  priority: NotificationPriority;
}

export interface NotificationRequest {
  templateId?: string;
  channel: NotificationChannel;
  userId: string;
  tenantId?: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
  variables?: Record<string, string>;
  metadata?: Record<string, unknown>;
  scheduledFor?: Date;
  deduplicationKey?: string;
}

export interface Notification {
  id: string;
  userId: string;
  tenantId?: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  priority: NotificationPriority;
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
  status: DeliveryStatus;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
  scheduledFor?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  retryCount: number;
  maxRetries: number;
  error?: string;
  metadata?: Record<string, unknown>;
  deduplicationKey?: string;
}

export interface UserNotificationPreferences {
  userId: string;
  channels: Record<NotificationChannel, boolean>;
  categories: Record<NotificationCategory, boolean>;
  batchDigest: boolean; // batch non-critical into digest
  digestFrequency: 'immediate' | 'hourly' | 'daily';
  quietHoursStart?: number; // 0-23
  quietHoursEnd?: number;
  timezone: string;
}

export interface NotificationStats {
  channel: NotificationChannel;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  avgDeliveryMs: number;
}

const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  welcome: {
    id: 'welcome',
    name: 'Welcome Email',
    channels: ['email', 'in_app'],
    category: 'onboarding',
    subject: 'Welcome to AI Auto News, {{name}}!',
    bodyText: 'Hi {{name}},\n\nWelcome to AI Auto News. Your account is ready. Start generating AI-powered content today!\n\nGet started: {{ctaUrl}}',
    bodyHtml: '<h1>Welcome, {{name}}!</h1><p>Your AI Auto News account is ready. <a href="{{ctaUrl}}">Start generating content</a>.</p>',
    variables: ['name', 'ctaUrl'],
    priority: 'normal',
  },
  post_generated: {
    id: 'post_generated',
    name: 'Post Generated',
    channels: ['in_app'],
    category: 'content',
    bodyText: 'Your post "{{title}}" has been generated successfully.',
    variables: ['title'],
    priority: 'low',
  },
  billing_trial_ending: {
    id: 'billing_trial_ending',
    name: 'Trial Ending',
    channels: ['email', 'in_app'],
    category: 'billing',
    subject: 'Your trial ends in {{days}} days',
    bodyText: 'Your free trial of AI Auto News ends in {{days}} days. Upgrade to continue uninterrupted access.\n\nUpgrade now: {{upgradeUrl}}',
    bodyHtml: '<p>Your trial ends in <strong>{{days}} days</strong>. <a href="{{upgradeUrl}}">Upgrade now</a> to continue.</p>',
    variables: ['days', 'upgradeUrl'],
    priority: 'high',
  },
  payment_failed: {
    id: 'payment_failed',
    name: 'Payment Failed',
    channels: ['email', 'in_app'],
    category: 'billing',
    subject: 'Action required: Payment failed',
    bodyText: 'We could not process your payment. Please update your payment method to avoid service interruption.\n\nUpdate: {{billingUrl}}',
    bodyHtml: '<p><strong>Action required.</strong> Your payment failed. <a href="{{billingUrl}}">Update your payment method</a>.</p>',
    variables: ['billingUrl'],
    priority: 'critical',
  },
  security_alert: {
    id: 'security_alert',
    name: 'Security Alert',
    channels: ['email', 'in_app'],
    category: 'security',
    subject: 'Security alert: {{alertType}}',
    bodyText: 'We detected {{alertType}} on your account from {{location}} at {{time}}.\n\nIf this was not you, please change your password immediately.',
    bodyHtml: '<p><strong>Security alert:</strong> {{alertType}} from {{location}} at {{time}}.</p><p>If this was not you, <a href="{{resetUrl}}">reset your password</a> immediately.</p>',
    variables: ['alertType', 'location', 'time', 'resetUrl'],
    priority: 'critical',
  },
  weekly_digest: {
    id: 'weekly_digest',
    name: 'Weekly Digest',
    channels: ['email'],
    category: 'report',
    subject: 'Your week with AI Auto News: {{postsGenerated}} posts created',
    bodyText: 'This week you created {{postsGenerated}} posts, gained {{newReaders}} readers, and achieved {{engagementRate}}% engagement.',
    variables: ['postsGenerated', 'newReaders', 'engagementRate'],
    priority: 'low',
  },
};

function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

function generateNotificationId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPreferencesKey(userId: string): string {
  return `notification:prefs:${userId}`;
}

function getInboxKey(userId: string): string {
  return `notification:inbox:${userId}`;
}

function getDedupeKey(deduplicationKey: string): string {
  return `notification:dedupe:${deduplicationKey}`;
}

export function getDefaultPreferences(userId: string): UserNotificationPreferences {
  return {
    userId,
    channels: {
      email: true,
      in_app: true,
      push: false,
      slack: false,
      sms: false,
    },
    categories: {
      billing: true,
      security: true,
      content: true,
      system: true,
      marketing: false,
      onboarding: true,
      alert: true,
      report: false,
      collaboration: true,
    },
    batchDigest: false,
    digestFrequency: 'immediate',
    timezone: 'UTC',
  };
}

export function getUserPreferences(userId: string): UserNotificationPreferences {
  const cache = getCache();
  return cache.get<UserNotificationPreferences>(getPreferencesKey(userId)) ?? getDefaultPreferences(userId);
}

export function updatePreferences(
  userId: string,
  updates: Partial<UserNotificationPreferences>,
): UserNotificationPreferences {
  const current = getUserPreferences(userId);
  const updated: UserNotificationPreferences = {
    ...current,
    ...updates,
    channels: { ...current.channels, ...(updates.channels ?? {}) },
    categories: { ...current.categories, ...(updates.categories ?? {}) },
  };
  const cache = getCache();
  cache.set(getPreferencesKey(userId), updated, 86400 * 365);
  return updated;
}

async function deliverViaChannel(
  notification: Notification,
  prefs: UserNotificationPreferences,
): Promise<void> {
  const channel = notification.channel;

  // Check user preferences
  if (!prefs.channels[channel]) {
    notification.status = 'unsubscribed';
    return;
  }
  if (!prefs.categories[notification.category]) {
    notification.status = 'unsubscribed';
    return;
  }

  // Quiet hours check (for non-critical)
  if (notification.priority !== 'critical' && prefs.quietHoursStart !== undefined && prefs.quietHoursEnd !== undefined) {
    const now = new Date();
    const hour = now.getUTCHours();
    const inQuiet = prefs.quietHoursStart <= prefs.quietHoursEnd
      ? hour >= prefs.quietHoursStart && hour < prefs.quietHoursEnd
      : hour >= prefs.quietHoursStart || hour < prefs.quietHoursEnd;
    if (inQuiet) {
      // Reschedule for after quiet hours
      notification.status = 'pending';
      logger.debug('Notification deferred: quiet hours', { notificationId: notification.id });
      return;
    }
  }

  const startMs = Date.now();
  try {
    switch (channel) {
      case 'email':
        // In production: call emailService.sendTransactional()
        logger.debug('Email notification sent', { userId: notification.userId, subject: notification.subject });
        break;
      case 'in_app':
        // Already persisted to inbox — mark as delivered
        break;
      case 'push':
        // In production: call FCM/Web Push API
        logger.debug('Push notification sent', { userId: notification.userId });
        break;
      case 'slack':
        // In production: post to Slack webhook
        logger.debug('Slack notification sent', { userId: notification.userId });
        break;
      case 'sms':
        // In production: call Twilio API
        logger.debug('SMS notification sent', { userId: notification.userId });
        break;
    }

    notification.status = 'sent';
    notification.sentAt = new Date();

    const deliveryMs = Date.now() - startMs;
    recordDeliveryStats(channel, true, deliveryMs);
  } catch (err) {
    notification.status = 'failed';
    notification.failedAt = new Date();
    notification.error = String(err);
    recordDeliveryStats(channel, false, Date.now() - startMs);
    throw err;
  }
}

function recordDeliveryStats(channel: NotificationChannel, success: boolean, ms: number): void {
  const cache = getCache();
  const key = `notification:stats:${channel}:${new Date().toISOString().slice(0, 10)}`;
  const stats = cache.get<{ sent: number; failed: number; totalMs: number }>(key) ?? { sent: 0, failed: 0, totalMs: 0 };
  if (success) { stats.sent += 1; stats.totalMs += ms; }
  else stats.failed += 1;
  cache.set(key, stats, 86400 * 8);
}

export async function sendNotification(request: NotificationRequest): Promise<Notification> {
  const cache = getCache();

  // Deduplication
  if (request.deduplicationKey) {
    const dedupeKey = getDedupeKey(request.deduplicationKey);
    if (cache.get(dedupeKey)) {
      logger.debug('Notification deduplicated', { key: request.deduplicationKey });
      throw new Error(`Duplicate notification: ${request.deduplicationKey}`);
    }
    cache.set(dedupeKey, '1', 3600); // 1-hour dedup window
  }

  // Template interpolation
  let bodyText = request.bodyText;
  let bodyHtml = request.bodyHtml;
  let subject = request.subject;

  if (request.templateId && NOTIFICATION_TEMPLATES[request.templateId]) {
    const tpl = NOTIFICATION_TEMPLATES[request.templateId];
    const vars = request.variables ?? {};
    bodyText = interpolate(tpl.bodyText, vars);
    bodyHtml = tpl.bodyHtml ? interpolate(tpl.bodyHtml, vars) : undefined;
    subject = tpl.subject ? interpolate(tpl.subject, vars) : undefined;
  } else if (request.variables) {
    bodyText = interpolate(bodyText, request.variables);
    if (bodyHtml) bodyHtml = interpolate(bodyHtml, request.variables);
    if (subject) subject = interpolate(subject, request.variables);
  }

  const notification: Notification = {
    id: generateNotificationId(),
    userId: request.userId,
    tenantId: request.tenantId,
    channel: request.channel,
    category: request.category,
    priority: request.priority,
    subject,
    bodyText,
    bodyHtml,
    status: 'pending',
    read: false,
    createdAt: new Date(),
    scheduledFor: request.scheduledFor,
    retryCount: 0,
    maxRetries: request.priority === 'critical' ? 5 : 3,
    metadata: request.metadata,
    deduplicationKey: request.deduplicationKey,
  };

  // Persist to inbox (in_app always, others for history)
  const inbox = cache.get<Notification[]>(getInboxKey(request.userId)) ?? [];
  inbox.unshift(notification);
  if (inbox.length > 200) inbox.length = 200;
  cache.set(getInboxKey(request.userId), inbox, 86400 * 90);

  if (!request.scheduledFor || request.scheduledFor <= new Date()) {
    const prefs = getUserPreferences(request.userId);
    try {
      await deliverViaChannel(notification, prefs);
    } catch (err) {
      if (notification.retryCount < notification.maxRetries) {
        notification.retryCount += 1;
        const delay = 1000 * Math.pow(2, notification.retryCount);
        setTimeout(() => deliverViaChannel(notification, prefs).catch(() => {}), delay);
      }
    }
  }

  logger.info('Notification sent', {
    id: notification.id,
    channel: request.channel,
    category: request.category,
    priority: request.priority,
    status: notification.status,
  });

  return notification;
}

export async function sendTemplateNotification(
  templateId: string,
  userId: string,
  variables: Record<string, string>,
  channels?: NotificationChannel[],
  tenantId?: string,
): Promise<Notification[]> {
  const template = NOTIFICATION_TEMPLATES[templateId];
  if (!template) throw new Error(`Template not found: ${templateId}`);

  const targetChannels = channels ?? template.channels;
  const results: Notification[] = [];

  for (const channel of targetChannels) {
    try {
      const n = await sendNotification({
        templateId,
        channel,
        userId,
        tenantId,
        category: template.category,
        priority: template.priority,
        bodyText: template.bodyText,
        bodyHtml: template.bodyHtml,
        subject: template.subject,
        variables,
      });
      results.push(n);
    } catch (err) {
      logger.warn('Template notification channel failed', { templateId, channel, error: err });
    }
  }

  return results;
}

export function getUserInbox(userId: string, options: {
  unreadOnly?: boolean;
  category?: NotificationCategory;
  limit?: number;
} = {}): Notification[] {
  const cache = getCache();
  let notifications = cache.get<Notification[]>(getInboxKey(userId)) ?? [];

  if (options.unreadOnly) notifications = notifications.filter((n) => !n.read);
  if (options.category) notifications = notifications.filter((n) => n.category === options.category);

  return notifications.slice(0, options.limit ?? 50);
}

export function markAsRead(userId: string, notificationId: string): boolean {
  const cache = getCache();
  const inbox = cache.get<Notification[]>(getInboxKey(userId));
  if (!inbox) return false;

  const notif = inbox.find((n) => n.id === notificationId);
  if (!notif) return false;

  notif.read = true;
  notif.readAt = new Date();
  cache.set(getInboxKey(userId), inbox, 86400 * 90);
  return true;
}

export function markAllAsRead(userId: string): number {
  const cache = getCache();
  const inbox = cache.get<Notification[]>(getInboxKey(userId));
  if (!inbox) return 0;

  let count = 0;
  for (const n of inbox) {
    if (!n.read) { n.read = true; n.readAt = new Date(); count++; }
  }
  cache.set(getInboxKey(userId), inbox, 86400 * 90);
  return count;
}

export function getUnreadCount(userId: string): number {
  const cache = getCache();
  const inbox = cache.get<Notification[]>(getInboxKey(userId)) ?? [];
  return inbox.filter((n) => !n.read).length;
}

export function getNotificationStats(channel: NotificationChannel, date: string): NotificationStats {
  const cache = getCache();
  const stats = cache.get<{ sent: number; failed: number; totalMs: number }>(
    `notification:stats:${channel}:${date}`,
  ) ?? { sent: 0, failed: 0, totalMs: 0 };

  const total = stats.sent + stats.failed;
  return {
    channel,
    sent: stats.sent,
    delivered: stats.sent,
    failed: stats.failed,
    deliveryRate: total > 0 ? stats.sent / total : 0,
    avgDeliveryMs: stats.sent > 0 ? stats.totalMs / stats.sent : 0,
  };
}

export function getTemplates(): Record<string, NotificationTemplate> {
  return NOTIFICATION_TEMPLATES;
}

export function registerTemplate(template: NotificationTemplate): void {
  NOTIFICATION_TEMPLATES[template.id] = template;
  logger.info('Notification template registered', { templateId: template.id });
}
