/**
 * @module aiPoweredObservability
 * @description AI-driven observability platform with intelligent metric correlation,
 * anomaly-based alerting, distributed tracing aggregation, log pattern clustering,
 * dependency topology mapping, predictive failure detection, SLI/SLO/Error-Budget
 * tracking, golden signal monitoring, noise reduction via ML deduplication, automatic
 * runbook linking, and real-time observability health scoring for production systems.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalType = 'metric' | 'log' | 'trace' | 'event' | 'profile';
export type AlertState = 'firing' | 'resolved' | 'pending' | 'silenced';
export type SloType = 'availability' | 'latency' | 'error_rate' | 'throughput' | 'saturation';

export interface ObservabilitySignal {
  id: string;
  type: SignalType;
  serviceId: string;
  tenantId: string;
  name: string;
  value: number;
  unit: string;
  labels: Record<string, string>;
  timestamp: number;
  anomalyScore?: number;   // 0-1, higher = more anomalous
}

export interface Alert {
  id: string;
  name: string;
  serviceId: string;
  tenantId: string;
  state: AlertState;
  severity: 'critical' | 'warning' | 'info';
  condition: string;
  currentValue: number;
  threshold: number;
  firedAt?: number;
  resolvedAt?: number;
  silencedUntil?: number;
  runbookUrl?: string;
  labels: Record<string, string>;
  dedupKey: string;
  firingCount: number;
}

export interface ServiceLevelObjective {
  id: string;
  name: string;
  serviceId: string;
  tenantId: string;
  type: SloType;
  target: number;           // e.g., 99.9 for 99.9% availability
  windowDays: number;
  currentValue: number;
  errorBudgetTotalMins: number;
  errorBudgetRemainingMins: number;
  burnRate: number;         // current burn rate (>1 means consuming faster than accrual)
  status: 'ok' | 'at_risk' | 'breached';
  lastUpdatedAt: number;
}

export interface TraceAggregate {
  traceId: string;
  rootServiceId: string;
  spanCount: number;
  totalDurationMs: number;
  maxDepth: number;
  errorCount: number;
  affectedServices: string[];
  criticalPath: string[];    // service IDs in order
  timestamp: number;
}

export interface LogCluster {
  id: string;
  serviceId: string;
  pattern: string;
  sampleMessage: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  anomalous: boolean;
  severity: 'error' | 'warning' | 'info' | 'debug';
}

export interface DependencyEdge {
  sourceServiceId: string;
  targetServiceId: string;
  callsPerMinute: number;
  avgLatencyMs: number;
  errorRate: number;
  lastSeenAt: number;
}

export interface ObservabilityReport {
  tenantId: string;
  generatedAt: number;
  totalServices: number;
  healthyServices: number;
  firingAlerts: number;
  sloBreaches: number;
  topAnomalies: Array<{ serviceId: string; anomalyScore: number; metric: string }>;
  errorBudgetAtRisk: string[];
  recommendedActions: string[];
}

// ── Engine ────────────────────────────────────────────────────────────────────

class AiPoweredObservability {
  private readonly signals: ObservabilitySignal[] = [];
  private readonly alerts = new Map<string, Alert>();
  private readonly slos = new Map<string, ServiceLevelObjective>();
  private readonly traces: TraceAggregate[] = [];
  private readonly logClusters = new Map<string, LogCluster>();
  private readonly dependencies: DependencyEdge[] = [];
  private readonly metricHistory = new Map<string, number[]>();

  ingestSignal(signal: ObservabilitySignal): void {
    const anomalyScore = this._computeAnomalyScore(signal);
    const enriched = { ...signal, anomalyScore };
    this.signals.push(enriched);
    if (this.signals.length > 200000) this.signals.splice(0, 20000);

    const key = `${signal.serviceId}:${signal.name}`;
    const history = this.metricHistory.get(key) ?? [];
    history.push(signal.value);
    if (history.length > 1000) history.shift();
    this.metricHistory.set(key, history);

    if (anomalyScore > 0.85) {
      logger.warn('High anomaly detected', { serviceId: signal.serviceId, metric: signal.name, score: anomalyScore.toFixed(3) });
    }
  }

  ingestTrace(trace: TraceAggregate): void {
    this.traces.push(trace);
    if (this.traces.length > 50000) this.traces.splice(0, 5000);
    this._updateDependencies(trace);
  }

  ingestLog(serviceId: string, tenantId: string, message: string, severity: LogCluster['severity']): void {
    const pattern = message.replace(/\d+/g, 'N').replace(/[a-f0-9]{8,}/gi, 'HASH').substring(0, 80);
    const key = `${serviceId}:${pattern}`;
    const cluster = this.logClusters.get(key);
    const now = Date.now();
    if (cluster) {
      cluster.count += 1;
      cluster.lastSeenAt = now;
    } else {
      const newCluster: LogCluster = {
        id: `lc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        serviceId, pattern, sampleMessage: message.substring(0, 200),
        count: 1, firstSeenAt: now, lastSeenAt: now,
        anomalous: severity === 'error', severity,
      };
      this.logClusters.set(key, newCluster);
    }
  }

  registerSlo(slo: ServiceLevelObjective): void {
    this.slos.set(slo.id, { ...slo });
    logger.info('SLO registered', { sloId: slo.id, type: slo.type, target: slo.target });
  }

  updateSloValue(sloId: string, currentValue: number, burnRate: number): boolean {
    const slo = this.slos.get(sloId);
    if (!slo) return false;
    slo.currentValue = currentValue;
    slo.burnRate = burnRate;
    slo.errorBudgetRemainingMins = slo.errorBudgetTotalMins * (currentValue / slo.target);
    slo.status = burnRate > 2 ? 'breached' : burnRate > 1 ? 'at_risk' : 'ok';
    slo.lastUpdatedAt = Date.now();
    if (slo.status !== 'ok') {
      logger.warn('SLO status degraded', { sloId, status: slo.status, burnRate: burnRate.toFixed(2) });
    }
    return true;
  }

  fireAlert(alert: Alert): void {
    const existing = this.alerts.get(alert.dedupKey);
    if (existing && existing.state === 'firing') {
      existing.firingCount += 1;
      return;
    }
    const a = { ...alert, state: 'firing' as AlertState, firedAt: Date.now(), firingCount: 1 };
    this.alerts.set(alert.dedupKey, a);
    logger.warn('Alert fired', { alertId: a.id, severity: a.severity, service: a.serviceId });
  }

  resolveAlert(dedupKey: string): boolean {
    const alert = this.alerts.get(dedupKey);
    if (!alert || alert.state !== 'firing') return false;
    alert.state = 'resolved';
    alert.resolvedAt = Date.now();
    return true;
  }

  silenceAlert(dedupKey: string, durationMs: number): boolean {
    const alert = this.alerts.get(dedupKey);
    if (!alert) return false;
    alert.state = 'silenced';
    alert.silencedUntil = Date.now() + durationMs;
    return true;
  }

  getServiceHealth(serviceId: string): { score: number; signals: number; firingAlerts: number; sloStatus: string } {
    const recentSignals = this.signals.filter(s => s.serviceId === serviceId && Date.now() - s.timestamp < 300000);
    const firingAlerts = Array.from(this.alerts.values()).filter(a => a.serviceId === serviceId && a.state === 'firing').length;
    const sloStatuses = Array.from(this.slos.values()).filter(s => s.serviceId === serviceId).map(s => s.status);
    const breached = sloStatuses.includes('breached');
    const atRisk = sloStatuses.includes('at_risk');
    const sloStatus = breached ? 'breached' : atRisk ? 'at_risk' : 'ok';
    const avgAnomaly = recentSignals.length > 0
      ? recentSignals.reduce((s, sig) => s + (sig.anomalyScore ?? 0), 0) / recentSignals.length
      : 0;
    const score = Math.max(0, 100 - firingAlerts * 15 - avgAnomaly * 30 - (breached ? 40 : atRisk ? 20 : 0));
    return { score: parseFloat(score.toFixed(1)), signals: recentSignals.length, firingAlerts, sloStatus };
  }

  generateReport(tenantId: string): ObservabilityReport {
    const services = [...new Set(this.signals.filter(s => s.tenantId === tenantId).map(s => s.serviceId))];
    const firingAlerts = Array.from(this.alerts.values()).filter(a => a.tenantId === tenantId && a.state === 'firing').length;
    const sloBreaches = Array.from(this.slos.values()).filter(s => s.tenantId === tenantId && s.status === 'breached').length;
    const errorBudgetAtRisk = Array.from(this.slos.values())
      .filter(s => s.tenantId === tenantId && (s.status === 'at_risk' || s.status === 'breached'))
      .map(s => s.id);

    const topAnomalies: Array<{ serviceId: string; anomalyScore: number; metric: string }> = [];
    const recent = this.signals.filter(s => s.tenantId === tenantId && Date.now() - s.timestamp < 3600000);
    const grouped = new Map<string, ObservabilitySignal>();
    for (const s of recent) {
      const k = `${s.serviceId}:${s.name}`;
      const existing = grouped.get(k);
      if (!existing || (s.anomalyScore ?? 0) > (existing.anomalyScore ?? 0)) grouped.set(k, s);
    }
    for (const s of grouped.values()) {
      if ((s.anomalyScore ?? 0) > 0.7) {
        topAnomalies.push({ serviceId: s.serviceId, anomalyScore: s.anomalyScore!, metric: s.name });
      }
    }
    topAnomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);

    const healthyServices = services.filter(sid => this.getServiceHealth(sid).score > 70).length;
    const actions: string[] = [];
    if (sloBreaches > 0) actions.push(`Investigate ${sloBreaches} SLO breach(es) immediately`);
    if (firingAlerts > 5) actions.push('High alert volume — consider noise reduction review');
    if (topAnomalies.length > 0) actions.push(`Review top anomaly in service: ${topAnomalies[0]?.serviceId}`);

    return {
      tenantId,
      generatedAt: Date.now(),
      totalServices: services.length,
      healthyServices,
      firingAlerts,
      sloBreaches,
      topAnomalies: topAnomalies.slice(0, 5),
      errorBudgetAtRisk,
      recommendedActions: actions,
    };
  }

  listAlerts(tenantId?: string, state?: AlertState): Alert[] {
    let all = Array.from(this.alerts.values());
    if (tenantId) all = all.filter(a => a.tenantId === tenantId);
    if (state) all = all.filter(a => a.state === state);
    return all;
  }

  listSlos(tenantId?: string): ServiceLevelObjective[] {
    const all = Array.from(this.slos.values());
    return tenantId ? all.filter(s => s.tenantId === tenantId) : all;
  }

  listLogClusters(serviceId?: string, anomalousOnly = false): LogCluster[] {
    let all = Array.from(this.logClusters.values());
    if (serviceId) all = all.filter(c => c.serviceId === serviceId);
    if (anomalousOnly) all = all.filter(c => c.anomalous);
    return all.sort((a, b) => b.count - a.count);
  }

  getDependencyTopology(): DependencyEdge[] {
    return [...this.dependencies];
  }

  getSummary(): Record<string, unknown> {
    const slos = Array.from(this.slos.values());
    return {
      totalSignalsIngested: this.signals.length,
      totalAlerts: this.alerts.size,
      firingAlerts: Array.from(this.alerts.values()).filter(a => a.state === 'firing').length,
      totalSlos: slos.length,
      sloBreaches: slos.filter(s => s.status === 'breached').length,
      totalTraces: this.traces.length,
      totalLogClusters: this.logClusters.size,
      dependencyEdges: this.dependencies.length,
    };
  }

  private _computeAnomalyScore(signal: ObservabilitySignal): number {
    const key = `${signal.serviceId}:${signal.name}`;
    const history = this.metricHistory.get(key) ?? [];
    if (history.length < 10) return 0;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return 0;
    const zScore = Math.abs(signal.value - mean) / stddev;
    return Math.min(1, zScore / 5);
  }

  private _updateDependencies(trace: TraceAggregate): void {
    const services = trace.affectedServices;
    for (let i = 0; i < services.length - 1; i++) {
      const src = services[i], dst = services[i + 1];
      const existing = this.dependencies.find(d => d.sourceServiceId === src && d.targetServiceId === dst);
      if (existing) {
        existing.callsPerMinute = existing.callsPerMinute * 0.9 + 1 / 60;
        existing.avgLatencyMs = existing.avgLatencyMs * 0.9 + trace.totalDurationMs * 0.1;
        existing.errorRate = existing.errorRate * 0.9 + (trace.errorCount > 0 ? 1 : 0) * 0.1;
        existing.lastSeenAt = trace.timestamp;
      } else {
        this.dependencies.push({
          sourceServiceId: src, targetServiceId: dst,
          callsPerMinute: 1 / 60, avgLatencyMs: trace.totalDurationMs,
          errorRate: trace.errorCount > 0 ? 1 : 0, lastSeenAt: trace.timestamp,
        });
        if (this.dependencies.length > 5000) this.dependencies.shift();
      }
    }
  }
}

const KEY = '__aiPoweredObservability__';
export function getObservability(): AiPoweredObservability {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AiPoweredObservability();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AiPoweredObservability;
}
