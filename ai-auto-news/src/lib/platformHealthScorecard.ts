/**
 * @module platformHealthScorecard
 * @description Platform health scoring and SLA management with predictive degradation
 * alerts. Uses exponential weighted moving average (EWMA) for live scores, linear
 * regression for trend forecasting, and automatic SLA breach detection and recovery
 * tracking with weighted composite scoring across all health dimensions.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Interfaces ────────────────────────────────────────────────────────────────

export type HealthDimension =
  | 'availability'
  | 'latency'
  | 'error_rate'
  | 'throughput'
  | 'saturation'
  | 'data_freshness'
  | 'security'
  | 'compliance';

export interface HealthScore {
  dimension: HealthDimension;
  score: number;
  weight: number;
  status: 'healthy' | 'degraded' | 'critical';
  trend: 'improving' | 'stable' | 'degrading';
  details: string;
}

export interface PlatformScorecard {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: HealthScore[];
  generatedAt: number;
  slaCompliant: boolean;
  predictedScore?: number;
}

export interface SLATarget {
  metric: string;
  target: number;
  unit: string;
  measurementWindow: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface SLABreach {
  id: string;
  slaId: string;
  actualValue: number;
  targetValue: number;
  breachStart: number;
  breachEnd?: number;
  duration: number;
  impact: string;
}

export interface HealthTrend {
  dimension: HealthDimension;
  dataPoints: Array<{ timestamp: number; score: number }>;
  forecast: number[];
  changeRate: number;
}

export interface AlertThreshold {
  dimension: HealthDimension;
  warning: number;
  critical: number;
  notifyChannels: string[];
}

export interface HealthEvent {
  id: string;
  type: 'breach' | 'recovery' | 'degradation' | 'improvement';
  dimension: HealthDimension;
  score: number;
  timestamp: number;
  description: string;
}

// ── Dimension weights ─────────────────────────────────────────────────────────

const DIMENSION_WEIGHTS: Record<HealthDimension, number> = {
  availability: 0.30,
  latency: 0.20,
  error_rate: 0.20,
  throughput: 0.15,
  saturation: 0.15,
  data_freshness: 0.00,
  security: 0.00,
  compliance: 0.00,
};

// Normalise so all active weights sum to 1.0 (covers all 8 when extras present)
const WEIGHT_OVERRIDE: Partial<Record<HealthDimension, number>> = {
  data_freshness: 0.05,
  security: 0.025,
  compliance: 0.025,
};

// ── Internal types ────────────────────────────────────────────────────────────

interface MetricPoint {
  timestamp: number;
  value: number;
}

interface SLARecord {
  id: string;
  target: SLATarget;
  activeBreach?: SLABreach;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class PlatformHealthScorecard {
  private metricStore: Map<HealthDimension, MetricPoint[]> = new Map();
  private ewmaScores: Map<HealthDimension, number> = new Map();
  private slas: Map<string, SLARecord> = new Map();
  private thresholds: Map<HealthDimension, AlertThreshold> = new Map();
  private events: HealthEvent[] = [];
  private eventHandlers: Array<(event: HealthEvent) => void> = [];
  private breachHistory: SLABreach[] = [];
  private readonly EWMA_ALPHA = 0.2;
  private readonly MAX_POINTS = 1440; // 24h at 1-min granularity

  recordMetric(dimension: HealthDimension, value: number, timestamp?: number): void {
    const ts = timestamp ?? Date.now();
    const points = this.metricStore.get(dimension) ?? [];
    points.push({ timestamp: ts, value: Math.max(0, Math.min(1, value)) });
    if (points.length > this.MAX_POINTS) points.splice(0, points.length - this.MAX_POINTS);
    this.metricStore.set(dimension, points);

    // Update EWMA
    const prev = this.ewmaScores.get(dimension) ?? value;
    const ewma = this.EWMA_ALPHA * value + (1 - this.EWMA_ALPHA) * prev;
    this.ewmaScores.set(dimension, ewma);

    this.detectThresholdEvents(dimension, ewma);
    this.checkSLABreachForDimension(dimension, value, ts);

    logger.debug('Metric recorded', { dimension, value, ewma: ewma.toFixed(4) });
  }

  generateScorecard(): PlatformScorecard {
    const dimensions: HealthScore[] = [];
    const weights = this.effectiveWeights();

    for (const [dim, weight] of Object.entries(weights) as [HealthDimension, number][]) {
      const score = this.ewmaScores.get(dim) ?? this.computeDimensionScore(dim, 60);
      const trend = this.detectTrendDirection(this.metricStore.get(dim) ?? []);
      const status: HealthScore['status'] = score >= 0.9 ? 'healthy' : score >= 0.7 ? 'degraded' : 'critical';
      dimensions.push({
        dimension: dim,
        score,
        weight,
        status,
        trend,
        details: `EWMA score ${(score * 100).toFixed(1)}% — ${trend}`,
      });
    }

    const overallScore = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
    const grade = this.computeGrade(overallScore);
    const predicted = this.predictFutureScoret('availability', 30);
    const slaCompliant = this.checkSLACompliance(Array.from(this.slas.values()).map((s) => s.target)).length === 0;

    logger.info('Scorecard generated', { overallScore: overallScore.toFixed(3), grade, slaCompliant });
    return { overallScore, grade, dimensions, generatedAt: Date.now(), slaCompliant, predictedScore: predicted };
  }

  getHealthScore(dimension: HealthDimension): HealthScore {
    const score = this.ewmaScores.get(dimension) ?? this.computeDimensionScore(dimension, 60);
    const trend = this.detectTrendDirection(this.metricStore.get(dimension) ?? []);
    const status: HealthScore['status'] = score >= 0.9 ? 'healthy' : score >= 0.7 ? 'degraded' : 'critical';
    const weight = this.effectiveWeights()[dimension] ?? 0;
    return { dimension, score, weight, status, trend, details: `Current EWMA: ${(score * 100).toFixed(1)}%` };
  }

  predictFutureScoret(dimension: HealthDimension, horizonMinutes: number): number {
    const points = this.metricStore.get(dimension) ?? [];
    if (points.length < 2) return this.ewmaScores.get(dimension) ?? 0.9;
    const forecast = this.forecastScore(points, horizonMinutes);
    return Math.max(0, Math.min(1, forecast[forecast.length - 1] ?? 0.9));
  }

  checkSLACompliance(targets: SLATarget[]): SLABreach[] {
    const breaches: SLABreach[] = [];
    for (const target of targets) {
      const dim = target.metric as HealthDimension;
      const current = this.ewmaScores.get(dim) ?? 1;
      if (current < target.target) {
        const breach: SLABreach = {
          id: `breach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          slaId: `${target.metric}_${target.measurementWindow}`,
          actualValue: current,
          targetValue: target.target,
          breachStart: Date.now(),
          duration: 0,
          impact: `${target.severity.toUpperCase()}: ${target.metric} at ${(current * 100).toFixed(1)}% below ${(target.target * 100).toFixed(1)}% target`,
        };
        breaches.push(breach);
      }
    }
    return breaches;
  }

  registerSLA(target: SLATarget): string {
    const id = `sla_${target.metric}_${Date.now()}`;
    this.slas.set(id, { id, target });
    logger.info('SLA registered', { id, metric: target.metric, target: target.target });
    return id;
  }

  setAlertThreshold(threshold: AlertThreshold): void {
    this.thresholds.set(threshold.dimension, threshold);
    logger.info('Alert threshold set', { dimension: threshold.dimension, warning: threshold.warning, critical: threshold.critical });
  }

  getHealthTrend(dimension: HealthDimension, windowMinutes: number): HealthTrend {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const all = this.metricStore.get(dimension) ?? [];
    const dataPoints = all.filter((p) => p.timestamp >= cutoff).map((p) => ({ timestamp: p.timestamp, score: p.value }));
    const trend = this.detectTrendDirection(all.filter((p) => p.timestamp >= cutoff));
    const forecast = this.forecastScore(all, 30);
    const changeRate = dataPoints.length >= 2
      ? (dataPoints[dataPoints.length - 1].score - dataPoints[0].score) / (windowMinutes / 60)
      : 0;
    return { dimension, dataPoints, forecast, changeRate };
  }

  computeGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 0.93) return 'A';
    if (score >= 0.80) return 'B';
    if (score >= 0.65) return 'C';
    if (score >= 0.50) return 'D';
    return 'F';
  }

  onHealthEvent(handler: (event: HealthEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  getRecentEvents(limit: number): HealthEvent[] {
    return this.events.slice(-limit);
  }

  getStats(): { avgScore: number; slaComplianceRate: number; totalBreaches: number; mttr: number } {
    const allScores = Array.from(this.ewmaScores.values());
    const avgScore = allScores.length > 0 ? allScores.reduce((s, v) => s + v, 0) / allScores.length : 0;
    const resolved = this.breachHistory.filter((b) => b.breachEnd !== undefined);
    const mttr = resolved.length > 0
      ? resolved.reduce((s, b) => s + b.duration, 0) / resolved.length / 60_000
      : 0;
    const slaBreaches = this.breachHistory.length;
    const totalChecks = slaBreaches + this.slas.size;
    const slaComplianceRate = totalChecks > 0 ? 1 - slaBreaches / totalChecks : 1;
    return { avgScore, slaComplianceRate, totalBreaches: slaBreaches, mttr };
  }

  private computeDimensionScore(dimension: HealthDimension, windowMinutes: number): number {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const points = (this.metricStore.get(dimension) ?? []).filter((p) => p.timestamp >= cutoff);
    if (points.length === 0) return 1.0;
    return points.reduce((s, p) => s + p.value, 0) / points.length;
  }

  private detectTrendDirection(points: MetricPoint[]): 'improving' | 'stable' | 'degrading' {
    if (points.length < 5) return 'stable';
    const recent = points.slice(-10);
    const slope = this.linearRegressionSlope(recent.map((p, i) => ({ x: i, y: p.value })));
    if (slope > 0.005) return 'improving';
    if (slope < -0.005) return 'degrading';
    return 'stable';
  }

  private forecastScore(points: MetricPoint[], horizonSteps: number): number[] {
    if (points.length < 2) return Array(horizonSteps).fill(points[0]?.value ?? 0.9);
    const recent = points.slice(-60);
    const slope = this.linearRegressionSlope(recent.map((p, i) => ({ x: i, y: p.value })));
    const last = recent[recent.length - 1].value;
    return Array.from({ length: horizonSteps }, (_, i) =>
      Math.max(0, Math.min(1, last + slope * (i + 1))),
    );
  }

  private linearRegressionSlope(data: Array<{ x: number; y: number }>): number {
    const n = data.length;
    if (n < 2) return 0;
    const sumX = data.reduce((s, d) => s + d.x, 0);
    const sumY = data.reduce((s, d) => s + d.y, 0);
    const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
    const sumX2 = data.reduce((s, d) => s + d.x * d.x, 0);
    const denom = n * sumX2 - sumX * sumX;
    return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  }

  private effectiveWeights(): Record<HealthDimension, number> {
    const weights = { ...DIMENSION_WEIGHTS, ...WEIGHT_OVERRIDE } as Record<HealthDimension, number>;
    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    const out = {} as Record<HealthDimension, number>;
    for (const [k, v] of Object.entries(weights) as [HealthDimension, number][]) {
      out[k] = v / total;
    }
    return out;
  }

  private detectThresholdEvents(dimension: HealthDimension, score: number): void {
    const threshold = this.thresholds.get(dimension);
    if (!threshold) return;
    const type: HealthEvent['type'] =
      score < threshold.critical ? 'breach' :
      score < threshold.warning ? 'degradation' :
      'improvement';
    if (type === 'improvement') return;
    this.emitEvent({ id: `evt_${Date.now()}`, type, dimension, score, timestamp: Date.now(), description: `${dimension} score ${(score * 100).toFixed(1)}% crossed ${type} threshold` });
  }

  private checkSLABreachForDimension(dimension: HealthDimension, value: number, ts: number): void {
    for (const record of this.slas.values()) {
      if (record.target.metric !== dimension) continue;
      const isBreach = value < record.target.target;
      if (isBreach && !record.activeBreach) {
        record.activeBreach = {
          id: `breach_${ts}`,
          slaId: record.id,
          actualValue: value,
          targetValue: record.target.target,
          breachStart: ts,
          duration: 0,
          impact: `${record.target.severity}: ${dimension} breached`,
        };
        this.emitEvent({ id: `evt_${ts}`, type: 'breach', dimension, score: value, timestamp: ts, description: record.activeBreach.impact });
      } else if (!isBreach && record.activeBreach) {
        record.activeBreach.breachEnd = ts;
        record.activeBreach.duration = ts - record.activeBreach.breachStart;
        this.breachHistory.push({ ...record.activeBreach });
        this.emitEvent({ id: `evt_${ts}_r`, type: 'recovery', dimension, score: value, timestamp: ts, description: `${dimension} recovered after ${(record.activeBreach.duration / 60_000).toFixed(1)}m` });
        record.activeBreach = undefined;
      }
    }
  }

  private emitEvent(event: HealthEvent): void {
    this.events.push(event);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    this.eventHandlers.forEach((h) => {
      try { h(event); } catch (err) { logger.error('Health event handler threw', err instanceof Error ? err : new Error(String(err))); }
    });
  }

  /**
   * Returns the composite health score across all dimensions using the
   * configured dimension weights. Dimensions with no recorded metrics are
   * treated as fully healthy (score = 1.0) to avoid penalising unmonitored
   * but operational components.
   */
  getCompositeScore(): number {
    const weights = this.effectiveWeights();
    return (Object.entries(weights) as [HealthDimension, number][]).reduce((sum, [dim, w]) => {
      return sum + (this.ewmaScores.get(dim) ?? 1.0) * w;
    }, 0);
  }

  /**
   * Bulk-load historical metric samples (e.g. from a time-series DB) without
   * triggering live threshold checks. Useful for back-filling on service start.
   * Points are sorted ascending by timestamp before ingestion.
   */
  loadHistory(dimension: HealthDimension, points: Array<{ timestamp: number; value: number }>): void {
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    let ewma = sorted[0]?.value ?? 1.0;
    for (const p of sorted) {
      const clamped = Math.max(0, Math.min(1, p.value));
      ewma = this.EWMA_ALPHA * clamped + (1 - this.EWMA_ALPHA) * ewma;
    }
    const existing = this.metricStore.get(dimension) ?? [];
    const merged = [...existing, ...sorted.map((p) => ({ timestamp: p.timestamp, value: Math.max(0, Math.min(1, p.value)) }))]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-this.MAX_POINTS);
    this.metricStore.set(dimension, merged);
    this.ewmaScores.set(dimension, ewma);
    logger.info('History loaded', { dimension, pointCount: sorted.length, finalEwma: ewma.toFixed(4) });
  }

  /**
   * Computes the mean time to recover (MTTR) for a specific dimension by
   * examining all SLA breaches that have ended. Returns minutes.
   */
  getMTTRForDimension(dimension: HealthDimension): number {
    const relevant = this.breachHistory.filter(
      (b) => this.slas.get(b.slaId)?.target.metric === dimension && b.breachEnd !== undefined,
    );
    if (relevant.length === 0) return 0;
    return relevant.reduce((s, b) => s + b.duration, 0) / relevant.length / 60_000;
  }

  /**
   * Returns a map of dimension → anomaly flag. A dimension is flagged as
   * anomalous when its current EWMA deviates more than 2 standard deviations
   * from its rolling window mean, indicating an unexpected spike or drop.
   */
  detectAnomalies(windowMinutes = 60): Map<HealthDimension, boolean> {
    const result = new Map<HealthDimension, boolean>();
    const cutoff = Date.now() - windowMinutes * 60_000;
    for (const [dim, points] of this.metricStore.entries()) {
      const window = points.filter((p) => p.timestamp >= cutoff).map((p) => p.value);
      if (window.length < 5) { result.set(dim, false); continue; }
      const mean = window.reduce((s, v) => s + v, 0) / window.length;
      const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
      const std = Math.sqrt(variance);
      const current = this.ewmaScores.get(dim) ?? mean;
      result.set(dim, std > 0 ? Math.abs(current - mean) / std > 2.0 : false);
    }
    return result;
  }

  /**
   * Summarises open SLA breaches grouped by severity and returns a
   * prioritised list for incident management tooling.
   */
  getOpenBreachSummary(): Array<{ slaId: string; dimension: string; severity: string; durationMinutes: number }> {
    const now = Date.now();
    return Array.from(this.slas.values())
      .filter((r) => r.activeBreach !== undefined)
      .map((r) => ({
        slaId: r.id,
        dimension: r.target.metric,
        severity: r.target.severity,
        durationMinutes: Math.round((now - (r.activeBreach!.breachStart)) / 60_000),
      }))
      .sort((a, b) => {
        const ord: Record<string, number> = { critical: 0, major: 1, minor: 2 };
        return (ord[a.severity] ?? 3) - (ord[b.severity] ?? 3);
      });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__platformHealthScorecard__';

export function getPlatformHealthScorecard(): PlatformHealthScorecard {
  const g = globalThis as unknown as Record<string, PlatformHealthScorecard>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PlatformHealthScorecard();
    logger.info('PlatformHealthScorecard singleton initialised');
  }
  return g[GLOBAL_KEY];
}

export default getPlatformHealthScorecard;
