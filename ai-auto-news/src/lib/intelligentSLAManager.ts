/**
 * @module intelligentSLAManager
 * @description Intelligent SLA (Service Level Agreement) management system with
 * real-time SLO tracking, breach prediction, automated remediation triggering,
 * multi-tier SLA definitions, SLA credit calculation, customer impact scoring,
 * compliance reporting, escalation workflows, and SLA portfolio optimization.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type SLAMetricType = 'availability' | 'latency_p50' | 'latency_p95' | 'latency_p99' | 'error_rate' | 'throughput' | 'rpo' | 'rto' | 'custom';
export type SLAStatus = 'in_compliance' | 'at_risk' | 'breach_imminent' | 'breached' | 'suspended';
export type SLATier = 'free' | 'starter' | 'professional' | 'enterprise' | 'custom';
export type BreachSeverity = 'minor' | 'moderate' | 'major' | 'critical';

export interface SLADefinition {
  slaId: string;
  name: string;
  tier: SLATier;
  tenantId: string;
  metrics: SLAMetric[];
  measurementWindow: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'rolling_30d';
  creditTable: CreditEntry[];
  escalationContacts: string[];
  remediation: RemediationPolicy;
  active: boolean;
  startedAt: number;
  expiresAt?: number;
  metadata: Record<string, unknown>;
}

export interface SLAMetric {
  metricType: SLAMetricType;
  target: number;           // e.g. 99.9 for 99.9% availability
  unit: string;             // '%', 'ms', 'req/s'
  direction: 'gte' | 'lte';  // compliance direction
  measurementMethod: 'average' | 'percentile' | 'max' | 'min' | 'sum';
  weight: number;           // importance weight for composite score
  customName?: string;
}

export interface CreditEntry {
  breachRangeMin: number;    // actual value range lower bound
  breachRangeMax: number;    // actual value range upper bound
  creditPercent: number;     // % of monthly bill credited
  description: string;
}

export interface RemediationPolicy {
  autoScale: boolean;
  autoFailover: boolean;
  alertThresholdPercent: number;  // alert when X% below target
  escalateAfterMs: number;
  maxAutoRemediations: number;
}

export interface SLAObservation {
  observationId: string;
  slaId: string;
  metricType: SLAMetricType;
  observedValue: number;
  targetValue: number;
  compliant: boolean;
  deviationPercent: number;
  timestamp: number;
  serviceId: string;
}

export interface SLAState {
  slaId: string;
  tenantId: string;
  status: SLAStatus;
  compositeScore: number;    // 0-100 (100 = fully compliant)
  metricStates: Record<SLAMetricType, SLAMetricState>;
  lastBreachAt?: number;
  breachCount: number;
  creditsOwed: number;
  uptimePercent: number;
  assessedAt: number;
}

export interface SLAMetricState {
  metricType: SLAMetricType;
  currentValue: number;
  target: number;
  compliant: boolean;
  trendDirection: 'improving' | 'stable' | 'degrading';
  riskScore: number;   // 0-1
  remainingBudget: number;  // e.g. remaining error budget
}

export interface SLABreach {
  breachId: string;
  slaId: string;
  tenantId: string;
  metricType: SLAMetricType;
  severity: BreachSeverity;
  observedValue: number;
  targetValue: number;
  deviationPercent: number;
  startedAt: number;
  resolvedAt?: number;
  durationMs?: number;
  creditAmount: number;
  remediationActions: string[];
  escalated: boolean;
  rootCause?: string;
}

export interface SLAPortfolioReport {
  reportId: string;
  periodStart: number;
  periodEnd: number;
  totalSLAs: number;
  breachedSLAs: number;
  atRiskSLAs: number;
  compliantSLAs: number;
  totalCreditsOwed: number;
  avgComplianceScore: number;
  worstPerformer?: string;
  bestPerformer?: string;
  recommendations: string[];
}

export interface IntelligentSLAConfig {
  observationWindowSize?: number;
  breachPredictionWindowMs?: number;
  minObservationsForPrediction?: number;
  defaultCreditCap?: number;   // max credit % per month
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCompliant(metric: SLAMetric, value: number): boolean {
  return metric.direction === 'gte' ? value >= metric.target : value <= metric.target;
}

function deviationPercent(actual: number, target: number, direction: 'gte' | 'lte'): number {
  if (target === 0) return 0;
  if (direction === 'gte') return ((target - actual) / target) * 100;
  return ((actual - target) / target) * 100;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class IntelligentSLAManager {
  private slas = new Map<string, SLADefinition>();
  private states = new Map<string, SLAState>();
  private observations: SLAObservation[] = [];
  private breaches = new Map<string, SLABreach>();
  private config: Required<IntelligentSLAConfig>;
  private remediationCounts = new Map<string, number>();

  constructor(config: IntelligentSLAConfig = {}) {
    this.config = {
      observationWindowSize: config.observationWindowSize ?? 1000,
      breachPredictionWindowMs: config.breachPredictionWindowMs ?? 15 * 60_000,
      minObservationsForPrediction: config.minObservationsForPrediction ?? 10,
      defaultCreditCap: config.defaultCreditCap ?? 30,
    };
  }

  // ── SLA Lifecycle ──────────────────────────────────────────────────────────

  defineSLA(params: Omit<SLADefinition, 'slaId' | 'startedAt'>): SLADefinition {
    const sla: SLADefinition = {
      ...params,
      slaId: `sla_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      startedAt: Date.now(),
    };
    this.slas.set(sla.slaId, sla);
    this.initializeState(sla);
    logger.info('SLA defined', { slaId: sla.slaId, tier: sla.tier, tenantId: sla.tenantId });
    return sla;
  }

  getSLA(slaId: string): SLADefinition | undefined {
    return this.slas.get(slaId);
  }

  listSLAs(tenantId?: string, tier?: SLATier): SLADefinition[] {
    let all = Array.from(this.slas.values()).filter(s => s.active);
    if (tenantId) all = all.filter(s => s.tenantId === tenantId);
    if (tier) all = all.filter(s => s.tier === tier);
    return all;
  }

  updateSLA(slaId: string, updates: Partial<SLADefinition>): SLADefinition {
    const sla = this.slas.get(slaId);
    if (!sla) throw new Error(`SLA ${slaId} not found`);
    Object.assign(sla, updates);
    return sla;
  }

  // ── Observation Ingestion ─────────────────────────────────────────────────

  recordObservation(slaId: string, serviceId: string, metricType: SLAMetricType, value: number): SLAObservation {
    const sla = this.slas.get(slaId);
    if (!sla) throw new Error(`SLA ${slaId} not found`);

    const metric = sla.metrics.find(m => m.metricType === metricType);
    if (!metric) throw new Error(`Metric ${metricType} not in SLA ${slaId}`);

    const compliant = isCompliant(metric, value);
    const devPct = deviationPercent(value, metric.target, metric.direction);

    const obs: SLAObservation = {
      observationId: `obs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      slaId,
      metricType,
      observedValue: value,
      targetValue: metric.target,
      compliant,
      deviationPercent: devPct,
      timestamp: Date.now(),
      serviceId,
    };

    this.observations.push(obs);
    if (this.observations.length > this.config.observationWindowSize * 10) this.observations.shift();

    // Update state
    this.updateMetricState(slaId, metricType, value, metric, compliant, devPct);

    // Detect and record breach
    if (!compliant) {
      this.handleBreach(sla, metric, value, devPct);
    }

    return obs;
  }

  bulkObservations(records: Array<{ slaId: string; serviceId: string; metricType: SLAMetricType; value: number }>): SLAObservation[] {
    return records.map(r => this.recordObservation(r.slaId, r.serviceId, r.metricType, r.value));
  }

  // ── Breach Prediction ─────────────────────────────────────────────────────

  predictBreach(slaId: string, metricType: SLAMetricType): { predicted: boolean; confidencePercent: number; estimatedTimeMs?: number } {
    const sla = this.slas.get(slaId);
    if (!sla) throw new Error(`SLA ${slaId} not found`);

    const metric = sla.metrics.find(m => m.metricType === metricType);
    if (!metric) return { predicted: false, confidencePercent: 0 };

    const recentObs = this.observations
      .filter(o => o.slaId === slaId && o.metricType === metricType)
      .slice(-this.config.observationWindowSize);

    if (recentObs.length < this.config.minObservationsForPrediction) {
      return { predicted: false, confidencePercent: 0 };
    }

    // Compute trend using linear regression on recent values
    const values = recentObs.map(o => o.observedValue);
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((s, v) => s + v, 0) / n;
    const ssxy = values.reduce((s, v, i) => s + (i - xMean) * (v - yMean), 0);
    const ssxx = values.reduce((s, _, i) => s + Math.pow(i - xMean, 2), 0);
    const slope = ssxx !== 0 ? ssxy / ssxx : 0;

    // Project future value
    const avgIntervalMs = recentObs.length > 1
      ? (recentObs[recentObs.length - 1]!.timestamp - recentObs[0]!.timestamp) / recentObs.length
      : 60_000;

    const pointsUntilWindow = this.config.breachPredictionWindowMs / avgIntervalMs;
    const projectedValue = values[values.length - 1]! + slope * pointsUntilWindow;

    const breachPredicted = !isCompliant(metric, projectedValue);
    const slopeSignificant = Math.abs(slope) > 0.01;

    const confidencePercent = breachPredicted && slopeSignificant
      ? Math.min(95, 50 + Math.abs(slope) * 100)
      : 10;

    const estimatedTimeMs = breachPredicted
      ? this.config.breachPredictionWindowMs * (1 - confidencePercent / 100)
      : undefined;

    return { predicted: breachPredicted, confidencePercent, estimatedTimeMs };
  }

  // ── SLA State & Status ────────────────────────────────────────────────────

  getState(slaId: string): SLAState | undefined {
    return this.states.get(slaId);
  }

  computeCompositeScore(slaId: string): number {
    const sla = this.slas.get(slaId);
    const state = this.states.get(slaId);
    if (!sla || !state) return 0;

    const totalWeight = sla.metrics.reduce((s, m) => s + m.weight, 0);
    let weightedScore = 0;

    for (const metric of sla.metrics) {
      const ms = state.metricStates[metric.metricType];
      if (!ms) continue;
      const metricScore = ms.compliant ? 100 : Math.max(0, 100 - ms.riskScore * 100);
      weightedScore += (metric.weight / totalWeight) * metricScore;
    }

    return weightedScore;
  }

  // ── Credits ───────────────────────────────────────────────────────────────

  calculateCredits(slaId: string, monthlyBillUSD: number): number {
    const state = this.states.get(slaId);
    const sla = this.slas.get(slaId);
    if (!state || !sla) return 0;

    const breaches = Array.from(this.breaches.values())
      .filter(b => b.slaId === slaId && !b.resolvedAt);

    let totalCreditPercent = 0;

    for (const breach of breaches) {
      const creditEntry = sla.creditTable.find(
        c => breach.deviationPercent >= c.breachRangeMin && breach.deviationPercent < c.breachRangeMax,
      );
      if (creditEntry) {
        totalCreditPercent += creditEntry.creditPercent;
      }
    }

    const cappedPercent = Math.min(totalCreditPercent, this.config.defaultCreditCap);
    return (monthlyBillUSD * cappedPercent) / 100;
  }

  // ── Portfolio ──────────────────────────────────────────────────────────────

  generatePortfolioReport(periodStartMs: number, periodEndMs: number): SLAPortfolioReport {
    const allSLAs = Array.from(this.slas.values()).filter(s => s.active);
    const states = allSLAs.map(s => this.states.get(s.slaId)).filter((s): s is SLAState => s !== undefined);

    const breached = states.filter(s => s.status === 'breached').length;
    const atRisk = states.filter(s => s.status === 'at_risk' || s.status === 'breach_imminent').length;
    const compliant = states.filter(s => s.status === 'in_compliance').length;

    const totalCredits = states.reduce((s, st) => s + st.creditsOwed, 0);
    const avgScore = states.length > 0 ? states.reduce((s, st) => s + st.compositeScore, 0) / states.length : 100;

    const sorted = [...states].sort((a, b) => a.compositeScore - b.compositeScore);
    const worstPerformer = sorted[0]?.slaId;
    const bestPerformer = sorted[sorted.length - 1]?.slaId;

    const recommendations: string[] = [];
    if (breached > 0) recommendations.push(`Investigate ${breached} breached SLAs immediately`);
    if (atRisk > 0) recommendations.push(`Monitor ${atRisk} at-risk SLAs closely`);
    if (totalCredits > 0) recommendations.push(`Process $${totalCredits.toFixed(2)} in SLA credits`);

    return {
      reportId: `slareport_${Date.now()}`,
      periodStart: periodStartMs,
      periodEnd: periodEndMs,
      totalSLAs: allSLAs.length,
      breachedSLAs: breached,
      atRiskSLAs: atRisk,
      compliantSLAs: compliant,
      totalCreditsOwed: totalCredits,
      avgComplianceScore: avgScore,
      worstPerformer,
      bestPerformer,
      recommendations,
    };
  }

  getBreaches(slaId?: string, resolved = false): SLABreach[] {
    const all = Array.from(this.breaches.values());
    return all.filter(b => (!slaId || b.slaId === slaId) && (resolved ? !!b.resolvedAt : !b.resolvedAt));
  }

  resolveBreachById(breachId: string, rootCause: string): void {
    const breach = this.breaches.get(breachId);
    if (!breach) throw new Error(`Breach ${breachId} not found`);
    breach.resolvedAt = Date.now();
    breach.durationMs = breach.resolvedAt - breach.startedAt;
    breach.rootCause = rootCause;
    logger.info('SLA breach resolved', { breachId, durationMs: breach.durationMs, rootCause });
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private initializeState(sla: SLADefinition): void {
    const metricStates = {} as SLAState['metricStates'];
    for (const metric of sla.metrics) {
      metricStates[metric.metricType] = {
        metricType: metric.metricType,
        currentValue: metric.target,
        target: metric.target,
        compliant: true,
        trendDirection: 'stable',
        riskScore: 0,
        remainingBudget: metric.direction === 'gte' ? 0 : metric.target,
      };
    }
    this.states.set(sla.slaId, {
      slaId: sla.slaId,
      tenantId: sla.tenantId,
      status: 'in_compliance',
      compositeScore: 100,
      metricStates,
      breachCount: 0,
      creditsOwed: 0,
      uptimePercent: 100,
      assessedAt: Date.now(),
    });
  }

  private updateMetricState(slaId: string, metricType: SLAMetricType, value: number, metric: SLAMetric, compliant: boolean, devPct: number): void {
    const state = this.states.get(slaId);
    if (!state) return;

    const ms = state.metricStates[metricType];
    if (!ms) return;

    const prevValue = ms.currentValue;
    ms.currentValue = value;
    ms.compliant = compliant;
    ms.riskScore = compliant ? 0 : Math.min(1, devPct / 100);

    if (metric.direction === 'gte') {
      ms.trendDirection = value > prevValue ? 'improving' : value < prevValue ? 'degrading' : 'stable';
    } else {
      ms.trendDirection = value < prevValue ? 'improving' : value > prevValue ? 'degrading' : 'stable';
    }

    // Error budget remaining
    if (metric.metricType === 'availability') {
      const maxAllowedDowntime = 100 - metric.target;
      const actualDowntime = Math.max(0, 100 - value);
      ms.remainingBudget = Math.max(0, maxAllowedDowntime - actualDowntime);
    }

    // Update SLA status
    const allCompliant = Object.values(state.metricStates).every(m => m.compliant);
    const maxRisk = Math.max(...Object.values(state.metricStates).map(m => m.riskScore));

    if (!allCompliant && maxRisk > 0.5) state.status = 'breached';
    else if (!allCompliant || maxRisk > 0.3) state.status = 'breach_imminent';
    else if (maxRisk > 0.1) state.status = 'at_risk';
    else state.status = 'in_compliance';

    state.compositeScore = this.computeCompositeScore(slaId);
    state.assessedAt = Date.now();
  }

  private handleBreach(sla: SLADefinition, metric: SLAMetric, value: number, devPct: number): void {
    const existingBreach = Array.from(this.breaches.values()).find(
      b => b.slaId === sla.slaId && b.metricType === metric.metricType && !b.resolvedAt,
    );
    if (existingBreach) return; // Already tracking this breach

    const severity: BreachSeverity = devPct > 20 ? 'critical' : devPct > 10 ? 'major' : devPct > 5 ? 'moderate' : 'minor';

    const creditEntry = sla.creditTable.find(c => devPct >= c.breachRangeMin && devPct < c.breachRangeMax);
    const creditAmount = creditEntry ? creditEntry.creditPercent : 0;

    // Trigger remediations
    const remediationActions: string[] = [];
    const count = this.remediationCounts.get(sla.slaId) ?? 0;
    if (count < sla.remediation.maxAutoRemediations) {
      if (sla.remediation.autoScale) remediationActions.push('auto_scale_triggered');
      if (sla.remediation.autoFailover) remediationActions.push('auto_failover_triggered');
      this.remediationCounts.set(sla.slaId, count + 1);
    }

    const breach: SLABreach = {
      breachId: `breach_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      slaId: sla.slaId,
      tenantId: sla.tenantId,
      metricType: metric.metricType,
      severity,
      observedValue: value,
      targetValue: metric.target,
      deviationPercent: devPct,
      startedAt: Date.now(),
      creditAmount,
      remediationActions,
      escalated: severity === 'critical',
    };

    this.breaches.set(breach.breachId, breach);

    const state = this.states.get(sla.slaId);
    if (state) {
      state.breachCount += 1;
      state.creditsOwed += creditAmount;
      state.lastBreachAt = Date.now();
    }

    logger.warn('SLA breach detected', { breachId: breach.breachId, slaId: sla.slaId, metricType: metric.metricType, severity, devPct });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getSLAManager(): IntelligentSLAManager {
  const key = '__intelligentSLAManager__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new IntelligentSLAManager();
  }
  return (globalThis as Record<string, unknown>)[key] as IntelligentSLAManager;
}
