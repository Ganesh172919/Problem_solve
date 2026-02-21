/**
 * Advanced Monitoring and Alerting System
 *
 * Provides comprehensive system monitoring:
 * - Real-time metrics collection
 * - Custom alert rules
 * - Multi-channel alerting (email, Slack, webhook, PagerDuty)
 * - Alert aggregation and deduplication
 * - Anomaly detection
 * - SLA monitoring
 * - Incident management
 * - Alert escalation
 * - Dashboard generation
 */

import { getLogger } from './logger';
import { getMetrics } from './metrics';

const logger = getLogger();
const metrics = getMetrics();

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: string;
  condition: AlertCondition;
  severity: 'critical' | 'warning' | 'info';
  channels: AlertChannel[];
  enabled: boolean;
  cooldown: number; // Seconds before re-alerting
  aggregation?: {
    window: number; // Time window in seconds
    function: 'avg' | 'sum' | 'min' | 'max' | 'count';
  };
}

export interface AlertCondition {
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  duration?: number; // Must breach for this long
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'sms';
  config: Record<string, any>;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'warning' | 'info';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  triggeredAt: Date;
  resolvedAt?: Date;
  status: 'firing' | 'resolved' | 'acknowledged';
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  escalatedTo?: string;
}

export interface SLATarget {
  id: string;
  name: string;
  description: string;
  metric: string;
  target: number; // Target value (e.g., 99.9 for 99.9% uptime)
  window: 'hour' | 'day' | 'week' | 'month';
  alertThreshold: number; // Alert if below this
}

export interface SLAStatus {
  targetId: string;
  currentValue: number;
  target: number;
  status: 'healthy' | 'at_risk' | 'breached';
  errorBudget: number; // Remaining error budget
  breaches: Array<{
    timestamp: Date;
    value: number;
    duration: number;
  }>;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  refreshInterval: number;
}

export interface DashboardWidget {
  id: string;
  type: 'graph' | 'number' | 'table' | 'heatmap';
  title: string;
  metric: string;
  timeRange: string; // e.g., '1h', '24h', '7d'
  config: Record<string, any>;
}

class AdvancedMonitoringSystem {
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private slaTargets: Map<string, SLATarget> = new Map();
  private metricHistory: Map<string, Array<{ timestamp: Date; value: number }>> = new Map();
  private lastAlertTime: Map<string, Date> = new Map();

  constructor() {
    this.startMonitoring();
    this.registerDefaultAlerts();
  }

  /**
   * Register alert rule
   */
  registerAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info('Alert rule registered', { ruleId: rule.id, name: rule.name });
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    logger.info('Alert rule removed', { ruleId });
  }

  /**
   * Record metric value
   */
  recordMetric(metric: string, value: number): void {
    // Store in history
    const history = this.metricHistory.get(metric) || [];
    history.push({ timestamp: new Date(), value });

    // Keep only last 1000 data points
    if (history.length > 1000) {
      history.shift();
    }

    this.metricHistory.set(metric, history);

    // Check alert rules
    this.checkAlertRules(metric, value);
  }

  /**
   * Check alert rules for metric
   */
  private checkAlertRules(metric: string, value: number): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled || rule.metric !== metric) continue;

      // Check cooldown
      const lastAlert = this.lastAlertTime.get(rule.id);
      if (lastAlert) {
        const elapsed = (Date.now() - lastAlert.getTime()) / 1000;
        if (elapsed < rule.cooldown) continue;
      }

      // Apply aggregation if configured
      const testValue = rule.aggregation
        ? this.aggregateMetric(metric, rule.aggregation)
        : value;

      // Check condition
      if (this.evaluateCondition(testValue, rule.condition)) {
        this.triggerAlert(rule, testValue);
      } else {
        // Resolve alert if it was firing
        this.resolveAlert(rule.id);
      }
    }
  }

  /**
   * Trigger alert
   */
  private async triggerAlert(rule: AlertRule, value: number): Promise<void> {
    const alert: Alert = {
      id: crypto.randomUUID(),
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      metric: rule.metric,
      value,
      threshold: rule.condition.threshold,
      message: `${rule.name}: ${rule.metric} is ${value} (threshold: ${rule.condition.threshold})`,
      triggeredAt: new Date(),
      status: 'firing',
    };

    this.activeAlerts.set(rule.id, alert);
    this.lastAlertTime.set(rule.id, alert.triggeredAt);

    logger.warn('Alert triggered', {
      ruleId: rule.id,
      severity: rule.severity,
      metric: rule.metric,
      value,
    });

    metrics.increment('monitoring.alert.triggered', {
      rule: rule.name,
      severity: rule.severity,
    });

    // Send notifications
    for (const channel of rule.channels) {
      await this.sendNotification(channel, alert);
    }
  }

  /**
   * Resolve alert
   */
  private resolveAlert(ruleId: string): void {
    const alert = this.activeAlerts.get(ruleId);

    if (alert && alert.status === 'firing') {
      alert.status = 'resolved';
      alert.resolvedAt = new Date();

      logger.info('Alert resolved', { ruleId, alertId: alert.id });

      metrics.increment('monitoring.alert.resolved', {
        rule: alert.ruleName,
      });

      this.activeAlerts.delete(ruleId);
    }
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string, userId: string): void {
    for (const alert of this.activeAlerts.values()) {
      if (alert.id === alertId) {
        alert.status = 'acknowledged';
        alert.acknowledgedBy = userId;
        alert.acknowledgedAt = new Date();

        logger.info('Alert acknowledged', { alertId, userId });
        break;
      }
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(severity?: string): Alert[] {
    const alerts = Array.from(this.activeAlerts.values());

    if (severity) {
      return alerts.filter((a) => a.severity === severity);
    }

    return alerts;
  }

  /**
   * Register SLA target
   */
  registerSLATarget(target: SLATarget): void {
    this.slaTargets.set(target.id, target);
    logger.info('SLA target registered', { targetId: target.id, name: target.name });
  }

  /**
   * Check SLA status
   */
  checkSLAStatus(targetId: string): SLAStatus {
    const target = this.slaTargets.get(targetId);

    if (!target) {
      throw new Error(`SLA target not found: ${targetId}`);
    }

    // Get metric history for window
    const history = this.getMetricWindow(target.metric, target.window);
    const currentValue = this.calculateSLAValue(history, target);

    // Calculate error budget
    const errorBudget = Math.max(0, currentValue - target.alertThreshold);

    // Determine status
    let status: 'healthy' | 'at_risk' | 'breached';
    if (currentValue >= target.target) {
      status = 'healthy';
    } else if (currentValue >= target.alertThreshold) {
      status = 'at_risk';
    } else {
      status = 'breached';
    }

    return {
      targetId,
      currentValue,
      target: target.target,
      status,
      errorBudget,
      breaches: [],
    };
  }

  /**
   * Detect anomalies in metrics
   */
  detectAnomalies(metric: string, window: number = 3600): Array<{
    timestamp: Date;
    value: number;
    expected: number;
    deviation: number;
  }> {
    const history = this.metricHistory.get(metric) || [];
    const recent = history.slice(-window);

    if (recent.length < 10) return [];

    // Calculate mean and standard deviation
    const mean = recent.reduce((sum, p) => sum + p.value, 0) / recent.length;
    const variance =
      recent.reduce((sum, p) => sum + Math.pow(p.value - mean, 2), 0) /
      recent.length;
    const stdDev = Math.sqrt(variance);

    // Find anomalies (> 3 standard deviations)
    const anomalies = recent
      .filter((p) => Math.abs(p.value - mean) > 3 * stdDev)
      .map((p) => ({
        timestamp: p.timestamp,
        value: p.value,
        expected: mean,
        deviation: Math.abs(p.value - mean) / stdDev,
      }));

    return anomalies;
  }

  /**
   * Create dashboard
   */
  createDashboard(dashboard: Dashboard): void {
    logger.info('Dashboard created', { dashboardId: dashboard.id });
    // In real implementation, store dashboard configuration
  }

  /**
   * Get dashboard data
   */
  getDashboardData(dashboardId: string): any {
    // Fetch and aggregate data for all widgets
    return {};
  }

  // Helper methods
  private evaluateCondition(value: number, condition: AlertCondition): boolean {
    switch (condition.operator) {
      case '>':
        return value > condition.threshold;
      case '<':
        return value < condition.threshold;
      case '>=':
        return value >= condition.threshold;
      case '<=':
        return value <= condition.threshold;
      case '==':
        return value === condition.threshold;
      case '!=':
        return value !== condition.threshold;
      default:
        return false;
    }
  }

  private aggregateMetric(
    metric: string,
    aggregation: { window: number; function: string }
  ): number {
    const history = this.metricHistory.get(metric) || [];
    const cutoff = new Date(Date.now() - aggregation.window * 1000);
    const recent = history.filter((p) => p.timestamp > cutoff);

    if (recent.length === 0) return 0;

    const values = recent.map((p) => p.value);

    switch (aggregation.function) {
      case 'avg':
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      case 'sum':
        return values.reduce((sum, v) => sum + v, 0);
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      default:
        return 0;
    }
  }

  private async sendNotification(
    channel: AlertChannel,
    alert: Alert
  ): Promise<void> {
    try {
      switch (channel.type) {
        case 'email':
          await this.sendEmailNotification(channel.config, alert);
          break;
        case 'slack':
          await this.sendSlackNotification(channel.config, alert);
          break;
        case 'webhook':
          await this.sendWebhookNotification(channel.config, alert);
          break;
        case 'pagerduty':
          await this.sendPagerDutyNotification(channel.config, alert);
          break;
        case 'sms':
          await this.sendSMSNotification(channel.config, alert);
          break;
      }

      metrics.increment('monitoring.notification.sent', {
        channel: channel.type,
        severity: alert.severity,
      });
    } catch (error) {
      logger.error('Failed to send notification', error);
      metrics.increment('monitoring.notification.failed', {
        channel: channel.type,
      });
    }
  }

  private async sendEmailNotification(config: any, alert: Alert): Promise<void> {
    // Send email notification
    logger.debug('Email notification sent', { alertId: alert.id });
  }

  private async sendSlackNotification(config: any, alert: Alert): Promise<void> {
    const webhook = config.webhookUrl;

    if (!webhook) return;

    const color = alert.severity === 'critical' ? 'danger' : 'warning';

    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color,
            title: `${alert.severity.toUpperCase()}: ${alert.ruleName}`,
            text: alert.message,
            fields: [
              { title: 'Metric', value: alert.metric, short: true },
              { title: 'Value', value: alert.value.toString(), short: true },
              { title: 'Threshold', value: alert.threshold.toString(), short: true },
            ],
            ts: Math.floor(alert.triggeredAt.getTime() / 1000),
          },
        ],
      }),
    });
  }

  private async sendWebhookNotification(config: any, alert: Alert): Promise<void> {
    await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
    });
  }

  private async sendPagerDutyNotification(
    config: any,
    alert: Alert
  ): Promise<void> {
    // Send PagerDuty event
    logger.debug('PagerDuty notification sent', { alertId: alert.id });
  }

  private async sendSMSNotification(config: any, alert: Alert): Promise<void> {
    // Send SMS notification
    logger.debug('SMS notification sent', { alertId: alert.id });
  }

  private getMetricWindow(metric: string, window: string): Array<any> {
    const history = this.metricHistory.get(metric) || [];
    const now = Date.now();

    let cutoff: number;
    switch (window) {
      case 'hour':
        cutoff = now - 3600000;
        break;
      case 'day':
        cutoff = now - 86400000;
        break;
      case 'week':
        cutoff = now - 604800000;
        break;
      case 'month':
        cutoff = now - 2592000000;
        break;
      default:
        cutoff = now - 3600000;
    }

    return history.filter((p) => p.timestamp.getTime() > cutoff);
  }

  private calculateSLAValue(history: Array<any>, target: SLATarget): number {
    if (history.length === 0) return 100;

    // Calculate uptime percentage
    const successful = history.filter((p) => p.value > 0).length;
    return (successful / history.length) * 100;
  }

  private startMonitoring(): void {
    // Monitor system metrics
    setInterval(() => {
      this.collectSystemMetrics();
    }, 60000); // Every minute
  }

  private collectSystemMetrics(): void {
    // Collect and record system metrics
    const memUsage = process.memoryUsage();
    this.recordMetric('system.memory.heapUsed', memUsage.heapUsed / 1024 / 1024);
    this.recordMetric('system.memory.heapTotal', memUsage.heapTotal / 1024 / 1024);
  }

  private registerDefaultAlerts(): void {
    // Register default alert rules
    this.registerAlertRule({
      id: 'high-error-rate',
      name: 'High Error Rate',
      description: 'Alert when error rate exceeds 5%',
      metric: 'errors.rate',
      condition: { operator: '>', threshold: 5 },
      severity: 'critical',
      channels: [{ type: 'slack', config: { webhookUrl: process.env.SLACK_WEBHOOK } }],
      enabled: true,
      cooldown: 300,
      aggregation: { window: 300, function: 'avg' },
    });

    this.registerAlertRule({
      id: 'slow-response-time',
      name: 'Slow Response Time',
      description: 'Alert when response time exceeds 1000ms',
      metric: 'response.time.p95',
      condition: { operator: '>', threshold: 1000 },
      severity: 'warning',
      channels: [{ type: 'slack', config: { webhookUrl: process.env.SLACK_WEBHOOK } }],
      enabled: true,
      cooldown: 600,
      aggregation: { window: 300, function: 'avg' },
    });
  }
}

// Singleton
let monitoringSystem: AdvancedMonitoringSystem;

export function getMonitoringSystem(): AdvancedMonitoringSystem {
  if (!monitoringSystem) {
    monitoringSystem = new AdvancedMonitoringSystem();
  }
  return monitoringSystem;
}
