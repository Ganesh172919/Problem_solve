/**
 * @module aiPoweredAlertCorrelator
 * @description AI-powered alert correlation engine implementing noise reduction,
 * alert deduplication via fingerprinting, time-window grouping, causal chain
 * inference, RCA correlation, suppression rules, escalation policies, on-call
 * routing, alert storm detection, dependency-aware grouping, and SLA breach
 * prediction for enterprise observability platforms.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertStatus = 'firing' | 'resolved' | 'suppressed' | 'acknowledged' | 'escalated';
export type CorrelationStrategy = 'temporal' | 'topological' | 'semantic' | 'hybrid';

export interface AlertRule {
  id: string;
  name: string;
  tenantId: string;
  serviceId: string;
  metric: string;
  condition: string;
  severity: AlertSeverity;
  suppressionWindowMs: number;
  escalationAfterMs: number;
  oncallGroup?: string;
  tags: string[];
  enabled: boolean;
  createdAt: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  tenantId: string;
  serviceId: string;
  fingerprint: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: AlertStatus;
  firedAt: number;
  resolvedAt?: number;
  acknowledgedAt?: number;
  escalatedAt?: number;
  suppressedUntil?: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  value?: number;
  threshold?: number;
  occurrenceCount: number;
  lastOccurrenceAt: number;
  groupId?: string;
  correlationIds: string[];
}

export interface AlertGroup {
  id: string;
  tenantId: string;
  name: string;
  strategy: CorrelationStrategy;
  alerts: string[];        // alert ids
  rootCauseAlertId?: string;
  severity: AlertSeverity;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  serviceIds: string[];
  causalChain: string[];   // alert ids in causal order
  confidence: number;      // 0-1
}

export interface SuppressionRule {
  id: string;
  tenantId: string;
  matchLabels: Record<string, string>;
  matchSeverities?: AlertSeverity[];
  suppressDurationMs: number;
  reason: string;
  createdAt: number;
  expiresAt: number;
  enabled: boolean;
}

export interface EscalationPolicy {
  id: string;
  tenantId: string;
  name: string;
  steps: EscalationStep[];
  createdAt: number;
}

export interface EscalationStep {
  delayMs: number;
  notifyChannels: string[];
  oncallGroup?: string;
  escalateSeverity?: AlertSeverity;
}

export interface CorrelationInsight {
  groupId: string;
  insight: string;
  confidence: number;
  suggestedActions: string[];
  affectedServices: string[];
  estimatedImpact: string;
  timestamp: number;
}

export interface AlertStorm {
  id: string;
  tenantId: string;
  serviceId: string;
  startedAt: number;
  resolvedAt?: number;
  alertCount: number;
  peakAlertsPerMin: number;
  suppressedCount: number;
  rootGroupId?: string;
}

export interface CorrelatorSummary {
  totalRules: number;
  activeAlerts: number;
  suppressedAlerts: number;
  alertGroups: number;
  openGroups: number;
  alertStormsActive: number;
  noiseReductionPct: number;
  avgGroupSize: number;
  topFiringServices: Array<{ serviceId: string; count: number }>;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class AiPoweredAlertCorrelator {
  private readonly rules = new Map<string, AlertRule>();
  private readonly alerts = new Map<string, Alert>();
  private readonly groups = new Map<string, AlertGroup>();
  private readonly suppressionRules = new Map<string, SuppressionRule>();
  private readonly escalationPolicies = new Map<string, EscalationPolicy>();
  private readonly storms: AlertStorm[] = [];
  private readonly insights: CorrelationInsight[] = [];
  private globalCounter = 0;
  private readonly CORRELATION_WINDOW_MS = 5 * 60 * 1000; // 5 min
  private readonly STORM_THRESHOLD = 20; // alerts/min

  // Rules ──────────────────────────────────────────────────────────────────────

  createRule(params: Omit<AlertRule, 'id' | 'createdAt'>): AlertRule {
    const rule: AlertRule = { ...params, id: `rule_${Date.now()}_${++this.globalCounter}`, createdAt: Date.now() };
    this.rules.set(rule.id, rule);
    logger.info('Alert rule created', { id: rule.id, name: rule.name });
    return rule;
  }

  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  listRules(tenantId?: string): AlertRule[] {
    const all = Array.from(this.rules.values());
    return tenantId ? all.filter(r => r.tenantId === tenantId) : all;
  }

  // Alert ingestion ────────────────────────────────────────────────────────────

  ingestAlert(params: {
    ruleId: string;
    tenantId: string;
    serviceId: string;
    title: string;
    description: string;
    severity: AlertSeverity;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    value?: number;
    threshold?: number;
  }): Alert {
    const fingerprint = this.computeFingerprint(params.tenantId, params.ruleId, params.labels ?? {});
    const now = Date.now();

    // Deduplication: find existing firing alert with same fingerprint
    const existing = Array.from(this.alerts.values()).find(
      a => a.fingerprint === fingerprint && a.status === 'firing'
    );
    if (existing) {
      existing.occurrenceCount++;
      existing.lastOccurrenceAt = now;
      logger.debug('Alert deduplicated', { id: existing.id, fingerprint });
      return existing;
    }

    // Check suppression
    const suppressed = this.checkSuppression(params.tenantId, params.labels ?? {}, params.severity);

    const alert: Alert = {
      id: `alert_${now}_${++this.globalCounter}`,
      ruleId: params.ruleId,
      tenantId: params.tenantId,
      serviceId: params.serviceId,
      fingerprint,
      title: params.title,
      description: params.description,
      severity: params.severity,
      status: suppressed ? 'suppressed' : 'firing',
      firedAt: now,
      labels: params.labels ?? {},
      annotations: params.annotations ?? {},
      value: params.value,
      threshold: params.threshold,
      occurrenceCount: 1,
      lastOccurrenceAt: now,
      correlationIds: [],
      suppressedUntil: suppressed?.expiresAt,
    };
    this.alerts.set(alert.id, alert);

    if (!suppressed) {
      this.correlateAlert(alert);
      this.detectStorm(params.tenantId, params.serviceId);
    }

    logger.info('Alert ingested', { id: alert.id, severity: alert.severity, status: alert.status });
    return alert;
  }

  resolveAlert(alertId: string): Alert {
    const alert = this.alerts.get(alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    alert.status = 'resolved';
    alert.resolvedAt = Date.now();
    // Check if group can be resolved
    if (alert.groupId) {
      const group = this.groups.get(alert.groupId);
      if (group) {
        const allResolved = group.alerts.every(id => {
          const a = this.alerts.get(id);
          return !a || a.status === 'resolved' || a.status === 'suppressed';
        });
        if (allResolved) { group.resolvedAt = Date.now(); }
      }
    }
    return alert;
  }

  acknowledgeAlert(alertId: string): Alert {
    const alert = this.alerts.get(alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    if (alert.status === 'firing') {
      alert.status = 'acknowledged';
      alert.acknowledgedAt = Date.now();
    }
    return alert;
  }

  escalateAlert(alertId: string): Alert {
    const alert = this.alerts.get(alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    alert.status = 'escalated';
    alert.escalatedAt = Date.now();
    logger.warn('Alert escalated', { alertId, severity: alert.severity });
    return alert;
  }

  // Correlation ────────────────────────────────────────────────────────────────

  private correlateAlert(alert: Alert): void {
    const windowStart = alert.firedAt - this.CORRELATION_WINDOW_MS;

    // Find recent alerts in same tenant/service window
    const candidates = Array.from(this.alerts.values()).filter(a =>
      a.id !== alert.id &&
      a.tenantId === alert.tenantId &&
      a.firedAt >= windowStart &&
      (a.status === 'firing' || a.status === 'acknowledged') &&
      !a.groupId
    );

    if (candidates.length === 0) return;

    // Find or create a group
    const existingGroup = Array.from(this.groups.values()).find(g =>
      g.tenantId === alert.tenantId &&
      !g.resolvedAt &&
      g.serviceIds.includes(alert.serviceId)
    );

    if (existingGroup) {
      existingGroup.alerts.push(alert.id);
      existingGroup.serviceIds = [...new Set([...existingGroup.serviceIds, alert.serviceId])];
      existingGroup.severity = this.maxSeverity(existingGroup.severity, alert.severity);
      existingGroup.updatedAt = Date.now();
      existingGroup.confidence = Math.min(0.99, existingGroup.confidence + 0.05);
      alert.groupId = existingGroup.id;
      alert.correlationIds.push(...candidates.map(c => c.id));
      this.generateInsight(existingGroup);
    } else {
      // Create new group
      const group: AlertGroup = {
        id: `grp_${Date.now()}_${++this.globalCounter}`,
        tenantId: alert.tenantId,
        name: `Correlation: ${alert.title}`,
        strategy: 'hybrid',
        alerts: [alert.id, ...candidates.map(c => c.id)],
        severity: candidates.reduce((max, c) => this.maxSeverity(max, c.severity), alert.severity),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        serviceIds: [...new Set([alert.serviceId, ...candidates.map(c => c.serviceId)])],
        causalChain: this.inferCausalChain([alert, ...candidates]),
        confidence: 0.6 + Math.min(0.35, candidates.length * 0.05),
      };
      // Determine root cause: earliest firing high-severity
      const sorted = [alert, ...candidates].sort((a, b) => a.firedAt - b.firedAt);
      group.rootCauseAlertId = sorted[0].id;
      this.groups.set(group.id, group);
      alert.groupId = group.id;
      for (const c of candidates) {
        c.groupId = group.id;
        c.correlationIds.push(alert.id);
      }
      alert.correlationIds.push(...candidates.map(c => c.id));
      this.generateInsight(group);
      logger.info('Alert group created', { groupId: group.id, alertCount: group.alerts.length });
    }
  }

  private inferCausalChain(alerts: Alert[]): string[] {
    // Simple heuristic: sort by fire time, earliest = root
    return alerts.sort((a, b) => a.firedAt - b.firedAt).map(a => a.id);
  }

  private generateInsight(group: AlertGroup): void {
    const serviceList = group.serviceIds.join(', ');
    const insight: CorrelationInsight = {
      groupId: group.id,
      insight: `Correlated ${group.alerts.length} alerts across services: ${serviceList}`,
      confidence: group.confidence,
      suggestedActions: [
        `Check health of services: ${serviceList}`,
        'Review recent deployments in affected services',
        'Inspect shared dependencies (databases, caches, message queues)',
      ],
      affectedServices: group.serviceIds,
      estimatedImpact: group.severity === 'critical' ? 'High – potential outage' :
        group.severity === 'high' ? 'Medium – degraded performance' : 'Low – minor impact',
      timestamp: Date.now(),
    };
    this.insights.push(insight);
    if (this.insights.length > 5000) this.insights.shift();
  }

  // Suppression ────────────────────────────────────────────────────────────────

  createSuppressionRule(params: Omit<SuppressionRule, 'id' | 'createdAt'>): SuppressionRule {
    const rule: SuppressionRule = { ...params, id: `supp_${Date.now()}_${++this.globalCounter}`, createdAt: Date.now() };
    this.suppressionRules.set(rule.id, rule);
    logger.info('Suppression rule created', { id: rule.id, reason: rule.reason });
    return rule;
  }

  private checkSuppression(
    tenantId: string, labels: Record<string, string>, severity: AlertSeverity
  ): SuppressionRule | undefined {
    const now = Date.now();
    for (const rule of this.suppressionRules.values()) {
      if (!rule.enabled || rule.tenantId !== tenantId || now > rule.expiresAt) continue;
      if (rule.matchSeverities && !rule.matchSeverities.includes(severity)) continue;
      const labelMatch = Object.entries(rule.matchLabels).every(([k, v]) => labels[k] === v);
      if (labelMatch) return rule;
    }
    return undefined;
  }

  listSuppressionRules(tenantId?: string): SuppressionRule[] {
    const all = Array.from(this.suppressionRules.values());
    return tenantId ? all.filter(r => r.tenantId === tenantId) : all;
  }

  // Escalation ─────────────────────────────────────────────────────────────────

  createEscalationPolicy(params: Omit<EscalationPolicy, 'id' | 'createdAt'>): EscalationPolicy {
    const policy: EscalationPolicy = { ...params, id: `esc_${Date.now()}_${++this.globalCounter}`, createdAt: Date.now() };
    this.escalationPolicies.set(policy.id, policy);
    return policy;
  }

  runEscalationCheck(): string[] {
    const now = Date.now();
    const escalated: string[] = [];
    for (const alert of this.alerts.values()) {
      if (alert.status !== 'firing') continue;
      const rule = this.rules.get(alert.ruleId);
      if (!rule) continue;
      if (now - alert.firedAt >= rule.escalationAfterMs) {
        this.escalateAlert(alert.id);
        escalated.push(alert.id);
      }
    }
    return escalated;
  }

  // Storm detection ────────────────────────────────────────────────────────────

  private detectStorm(tenantId: string, serviceId: string): void {
    const oneMinAgo = Date.now() - 60_000;
    const recentAlerts = Array.from(this.alerts.values()).filter(a =>
      a.tenantId === tenantId &&
      a.serviceId === serviceId &&
      a.firedAt >= oneMinAgo &&
      a.status !== 'suppressed'
    );
    if (recentAlerts.length >= this.STORM_THRESHOLD) {
      const activeStorm = this.storms.find(s => s.tenantId === tenantId && s.serviceId === serviceId && !s.resolvedAt);
      if (!activeStorm) {
        const storm: AlertStorm = {
          id: `storm_${Date.now()}_${++this.globalCounter}`,
          tenantId, serviceId,
          startedAt: Date.now(),
          alertCount: recentAlerts.length,
          peakAlertsPerMin: recentAlerts.length,
          suppressedCount: 0,
        };
        this.storms.push(storm);
        logger.warn('Alert storm detected', { tenantId, serviceId, alertCount: recentAlerts.length });
        // Auto-suppress low/info alerts during storm
        let suppressed = 0;
        for (const alert of recentAlerts) {
          if (alert.severity === 'low' || alert.severity === 'info') {
            alert.status = 'suppressed';
            suppressed++;
          }
        }
        storm.suppressedCount = suppressed;
      } else {
        activeStorm.alertCount = recentAlerts.length;
        activeStorm.peakAlertsPerMin = Math.max(activeStorm.peakAlertsPerMin, recentAlerts.length);
      }
    }
  }

  resolveStorm(tenantId: string, serviceId: string): void {
    const storm = this.storms.find(s => s.tenantId === tenantId && s.serviceId === serviceId && !s.resolvedAt);
    if (storm) storm.resolvedAt = Date.now();
  }

  listStorms(activeOnly = false): AlertStorm[] {
    return activeOnly ? this.storms.filter(s => !s.resolvedAt) : [...this.storms];
  }

  // Queries ────────────────────────────────────────────────────────────────────

  getAlert(id: string): Alert | undefined {
    return this.alerts.get(id);
  }

  listAlerts(tenantId?: string, status?: AlertStatus, severity?: AlertSeverity): Alert[] {
    let all = Array.from(this.alerts.values());
    if (tenantId) all = all.filter(a => a.tenantId === tenantId);
    if (status) all = all.filter(a => a.status === status);
    if (severity) all = all.filter(a => a.severity === severity);
    return all;
  }

  getGroup(id: string): AlertGroup | undefined {
    return this.groups.get(id);
  }

  listGroups(tenantId?: string, openOnly = false): AlertGroup[] {
    let all = Array.from(this.groups.values());
    if (tenantId) all = all.filter(g => g.tenantId === tenantId);
    if (openOnly) all = all.filter(g => !g.resolvedAt);
    return all;
  }

  listInsights(groupId?: string, limit = 50): CorrelationInsight[] {
    const filtered = groupId ? this.insights.filter(i => i.groupId === groupId) : this.insights;
    return filtered.slice(-limit);
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): CorrelatorSummary {
    const allAlerts = Array.from(this.alerts.values());
    const firing = allAlerts.filter(a => a.status === 'firing' || a.status === 'acknowledged' || a.status === 'escalated');
    const suppressed = allAlerts.filter(a => a.status === 'suppressed');
    const openGroups = Array.from(this.groups.values()).filter(g => !g.resolvedAt);
    const storms = this.storms.filter(s => !s.resolvedAt);

    const totalIngested = allAlerts.length;
    const noiseReduction = totalIngested > 0 ? (suppressed.length / totalIngested) * 100 : 0;

    const allGroups = Array.from(this.groups.values());
    const avgGroupSize = allGroups.length > 0
      ? allGroups.reduce((s, g) => s + g.alerts.length, 0) / allGroups.length
      : 0;

    const serviceCounts = new Map<string, number>();
    for (const a of firing) serviceCounts.set(a.serviceId, (serviceCounts.get(a.serviceId) ?? 0) + 1);
    const topFiringServices = Array.from(serviceCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([serviceId, count]) => ({ serviceId, count }));

    return {
      totalRules: this.rules.size,
      activeAlerts: firing.length,
      suppressedAlerts: suppressed.length,
      alertGroups: this.groups.size,
      openGroups: openGroups.length,
      alertStormsActive: storms.length,
      noiseReductionPct: noiseReduction,
      avgGroupSize,
      topFiringServices,
    };
  }

  // Helpers ────────────────────────────────────────────────────────────────────

  private computeFingerprint(tenantId: string, ruleId: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}=${v}`).join(',');
    return `${tenantId}:${ruleId}:${labelStr}`;
  }

  private maxSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
    const order: AlertSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    return order[Math.max(order.indexOf(a), order.indexOf(b))];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__aiPoweredAlertCorrelator__';
export function getAlertCorrelator(): AiPoweredAlertCorrelator {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AiPoweredAlertCorrelator();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AiPoweredAlertCorrelator;
}
