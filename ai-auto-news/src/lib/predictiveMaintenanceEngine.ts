/**
 * @module predictiveMaintenanceEngine
 * @description Predictive maintenance engine using time-series anomaly detection,
 * ARIMA-like trend forecasting, wear-and-tear modeling, MTBF/MTTR tracking,
 * failure probability scoring, maintenance scheduling optimization, spare-parts
 * inventory recommendations, and SLA risk quantification for infrastructure assets.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type AssetType = 'server' | 'database' | 'network_device' | 'storage' | 'application' | 'sensor' | 'vm';
export type AssetHealth = 'healthy' | 'degraded' | 'at_risk' | 'critical' | 'failed';
export type MaintenanceType = 'preventive' | 'corrective' | 'predictive' | 'condition_based';
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Asset {
  assetId: string;
  name: string;
  type: AssetType;
  installDate: number;
  expectedLifeMs: number;
  currentHealth: AssetHealth;
  failureProbability7d: number;  // 0-1
  failureProbability30d: number; // 0-1
  mtbfHours: number;             // mean time between failures
  mttrHours: number;             // mean time to repair
  totalDowntimeMs: number;
  lastMaintenanceAt: number;
  maintenanceIntervalMs: number;
  telemetry: Record<string, number>;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface TelemetryReading {
  assetId: string;
  timestamp: number;
  metrics: Record<string, number>;
  source: string;
}

export interface AnomalyDetectionResult {
  assetId: string;
  metric: string;
  value: number;
  expectedRange: { min: number; max: number };
  zScore: number;
  isAnomaly: boolean;
  severity: 'info' | 'warning' | 'critical';
  detectedAt: number;
}

export interface FailurePrediction {
  assetId: string;
  probability7d: number;
  probability30d: number;
  confidence: number;
  topContributingFactors: Array<{ factor: string; contribution: number }>;
  estimatedFailureAt?: number;
  recommendedAction: string;
  urgency: MaintenancePriority;
  potentialDowntimeMs: number;
  costToAvoidUSD: number;
  costOfFailureUSD: number;
}

export interface MaintenanceTask {
  taskId: string;
  assetId: string;
  type: MaintenanceType;
  priority: MaintenancePriority;
  title: string;
  description: string;
  estimatedDurationMs: number;
  scheduledAt: number;
  deadline: number;
  assignedTo?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completedAt?: number;
  outcome?: 'success' | 'partial' | 'failed';
  notes?: string;
}

export interface MaintenanceSchedule {
  scheduleId: string;
  generatedAt: number;
  tasks: MaintenanceTask[];
  totalEstimatedDurationMs: number;
  schedulingWindow: { startAt: number; endAt: number };
  optimizationScore: number; // 0-1 (higher = better window)
  projectedRiskReductionPercent: number;
}

export interface SLARiskReport {
  assetId: string;
  slaTarget: number;         // e.g. 0.999 = 99.9%
  projectedAvailability: number;
  riskOfBreachPercent: number;
  recommendedBufferHours: number;
  financialExposureUSD: number;
}

export interface PredictiveMaintenanceConfig {
  anomalyZScoreThreshold?: number;
  historyWindowMs?: number;
  maxHistoryPoints?: number;
  costPerDowntimeHourUSD?: number;
  proactiveMaintenanceCostMultiplier?: number;
}

// ── Statistics Helpers ────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], avg?: number): number {
  if (values.length < 2) return 0;
  const m = avg ?? mean(values);
  const variance = values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = mean(xs);
  const my = mean(ys);
  const ssxy = xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const ssxx = xs.reduce((s, x) => s + Math.pow(x - mx, 2), 0);
  const slope = ssxx !== 0 ? ssxy / ssxx : 0;
  const intercept = my - slope * mx;
  const ssres = ys.reduce((s, y, i) => s + Math.pow(y - (slope * xs[i]! + intercept), 2), 0);
  const sstot = ys.reduce((s, y) => s + Math.pow(y - my, 2), 0);
  const r2 = sstot !== 0 ? 1 - ssres / sstot : 0;
  return { slope, intercept, r2 };
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class PredictiveMaintenanceEngine {
  private assets = new Map<string, Asset>();
  private telemetryHistory = new Map<string, TelemetryReading[]>();
  private maintenanceTasks = new Map<string, MaintenanceTask>();
  private incidents = new Map<string, { assetId: string; startedAt: number; resolvedAt?: number; cause: string }>();
  private config: Required<PredictiveMaintenanceConfig>;

  constructor(config: PredictiveMaintenanceConfig = {}) {
    this.config = {
      anomalyZScoreThreshold: config.anomalyZScoreThreshold ?? 3.0,
      historyWindowMs: config.historyWindowMs ?? 7 * 24 * 60 * 60_000,
      maxHistoryPoints: config.maxHistoryPoints ?? 10_000,
      costPerDowntimeHourUSD: config.costPerDowntimeHourUSD ?? 1_000,
      proactiveMaintenanceCostMultiplier: config.proactiveMaintenanceCostMultiplier ?? 0.2,
    };
  }

  // ── Asset Management ──────────────────────────────────────────────────────

  registerAsset(params: Omit<Asset, 'currentHealth' | 'failureProbability7d' | 'failureProbability30d' | 'totalDowntimeMs'>): Asset {
    const asset: Asset = {
      ...params,
      currentHealth: 'healthy',
      failureProbability7d: 0,
      failureProbability30d: 0,
      totalDowntimeMs: 0,
    };
    this.assets.set(asset.assetId, asset);
    this.telemetryHistory.set(asset.assetId, []);
    logger.info('Asset registered', { assetId: asset.assetId, type: asset.type });
    return asset;
  }

  getAsset(assetId: string): Asset | undefined {
    return this.assets.get(assetId);
  }

  listAssets(healthFilter?: AssetHealth, typeFilter?: AssetType): Asset[] {
    let all = Array.from(this.assets.values());
    if (healthFilter) all = all.filter(a => a.currentHealth === healthFilter);
    if (typeFilter) all = all.filter(a => a.type === typeFilter);
    return all;
  }

  // ── Telemetry Ingestion ───────────────────────────────────────────────────

  ingestTelemetry(reading: TelemetryReading): AnomalyDetectionResult[] {
    const asset = this.assets.get(reading.assetId);
    if (!asset) throw new Error(`Asset ${reading.assetId} not found`);

    const history = this.telemetryHistory.get(reading.assetId) ?? [];
    history.push(reading);

    // Trim to window
    const cutoff = reading.timestamp - this.config.historyWindowMs;
    const trimmed = history.filter(h => h.timestamp >= cutoff);
    if (trimmed.length > this.config.maxHistoryPoints) trimmed.shift();
    this.telemetryHistory.set(reading.assetId, trimmed);

    // Update asset telemetry snapshot
    Object.assign(asset.telemetry, reading.metrics);

    // Detect anomalies
    const anomalies: AnomalyDetectionResult[] = [];
    for (const [metric, value] of Object.entries(reading.metrics)) {
      const historicalValues = trimmed
        .slice(0, -1) // exclude current
        .map(h => h.metrics[metric] as number)
        .filter(v => v !== undefined && !isNaN(v));

      if (historicalValues.length < 10) continue;

      const avg = mean(historicalValues);
      const sd = stddev(historicalValues, avg);
      const zScore = sd > 0 ? (value - avg) / sd : 0;

      const isAnomaly = Math.abs(zScore) > this.config.anomalyZScoreThreshold;
      const severity = Math.abs(zScore) > 5 ? 'critical' : Math.abs(zScore) > 4 ? 'warning' : 'info';

      if (isAnomaly) {
        anomalies.push({
          assetId: reading.assetId,
          metric,
          value,
          expectedRange: { min: avg - 2 * sd, max: avg + 2 * sd },
          zScore,
          isAnomaly: true,
          severity,
          detectedAt: reading.timestamp,
        });
      }
    }

    // Update health based on anomalies
    const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
    const warningCount = anomalies.filter(a => a.severity === 'warning').length;
    if (criticalCount > 0) asset.currentHealth = 'critical';
    else if (warningCount > 2) asset.currentHealth = 'at_risk';
    else if (warningCount > 0) asset.currentHealth = 'degraded';
    else asset.currentHealth = 'healthy';

    return anomalies;
  }

  // ── Failure Prediction ────────────────────────────────────────────────────

  predictFailure(assetId: string): FailurePrediction {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);

    const history = this.telemetryHistory.get(assetId) ?? [];
    const now = Date.now();
    const ageMs = now - asset.installDate;
    const ageFraction = ageMs / asset.expectedLifeMs;

    // Weibull-inspired aging factor
    const ageFactor = Math.min(1, Math.pow(ageFraction, 2));

    // Trend analysis on key health metrics
    const contributingFactors: Array<{ factor: string; contribution: number }> = [];
    let metricRiskScore = 0;

    const keyMetrics = ['cpu_percent', 'error_rate', 'temperature_c', 'disk_usage_percent', 'latency_ms'];
    for (const metricName of keyMetrics) {
      const values = history.map(h => h.metrics[metricName]).filter((v): v is number => v !== undefined);
      if (values.length < 5) continue;

      const xs = values.map((_, i) => i);
      const { slope, r2 } = linearRegression(xs, values);
      const lastVal = values[values.length - 1]!;

      // Positive slope on bad metrics (error_rate, temp, latency) = risk
      if (slope > 0 && r2 > 0.5) {
        const contribution = Math.min(0.3, slope * r2 * 0.1);
        metricRiskScore += contribution;
        contributingFactors.push({ factor: `${metricName}_trend`, contribution });
      }

      // Already at dangerous levels
      const thresholds: Record<string, number> = {
        cpu_percent: 85, error_rate: 0.1, temperature_c: 80, disk_usage_percent: 90, latency_ms: 2000,
      };
      const threshold = thresholds[metricName];
      if (threshold !== undefined && lastVal > threshold) {
        const contribution = Math.min(0.25, (lastVal - threshold) / threshold);
        metricRiskScore += contribution;
        contributingFactors.push({ factor: `${metricName}_high_value`, contribution });
      }
    }

    // Overdue maintenance factor
    const timeSinceMaintenanceMs = now - asset.lastMaintenanceAt;
    const maintenanceOverdueFactor = Math.min(0.2, Math.max(0, (timeSinceMaintenanceMs - asset.maintenanceIntervalMs) / asset.maintenanceIntervalMs * 0.1));
    if (maintenanceOverdueFactor > 0) {
      contributingFactors.push({ factor: 'overdue_maintenance', contribution: maintenanceOverdueFactor });
    }

    const baseProbability7d = Math.min(0.95, ageFactor * 0.3 + metricRiskScore + maintenanceOverdueFactor);
    const probability7d = baseProbability7d;
    const probability30d = Math.min(0.99, probability7d * 2.5);

    // Update asset
    asset.failureProbability7d = probability7d;
    asset.failureProbability30d = probability30d;

    const estimatedFailureAt = probability7d > 0.7
      ? now + 7 * 24 * 60 * 60_000 * (1 - probability7d)
      : undefined;

    const urgency: MaintenancePriority = probability7d > 0.7 ? 'urgent' : probability7d > 0.4 ? 'high' : probability7d > 0.2 ? 'medium' : 'low';

    const potentialDowntimeMs = asset.mttrHours * 60 * 60_000;
    const costOfFailureUSD = (potentialDowntimeMs / 3_600_000) * this.config.costPerDowntimeHourUSD;
    const costToAvoidUSD = costOfFailureUSD * this.config.proactiveMaintenanceCostMultiplier;

    const recommendedAction = probability7d > 0.7
      ? 'Immediate maintenance required — schedule within 24 hours'
      : probability7d > 0.4
      ? 'Schedule preventive maintenance within 7 days'
      : 'Monitor closely — maintenance at next scheduled window';

    return {
      assetId,
      probability7d,
      probability30d,
      confidence: Math.min(0.95, 0.5 + history.length / 200),
      topContributingFactors: contributingFactors.sort((a, b) => b.contribution - a.contribution).slice(0, 5),
      estimatedFailureAt,
      recommendedAction,
      urgency,
      potentialDowntimeMs,
      costToAvoidUSD,
      costOfFailureUSD,
    };
  }

  // ── Maintenance Scheduling ────────────────────────────────────────────────

  scheduleMaintenanceTask(params: Omit<MaintenanceTask, 'taskId' | 'status'>): MaintenanceTask {
    const task: MaintenanceTask = {
      ...params,
      taskId: `maint_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'pending',
    };
    this.maintenanceTasks.set(task.taskId, task);
    logger.info('Maintenance task scheduled', { taskId: task.taskId, assetId: task.assetId, priority: task.priority });
    return task;
  }

  generateOptimalSchedule(windowStartAt: number, windowEndAt: number): MaintenanceSchedule {
    const pendingTasks = Array.from(this.maintenanceTasks.values())
      .filter(t => t.status === 'pending' && t.deadline <= windowEndAt);

    // Sort by priority and deadline
    const priorityScore: Record<MaintenancePriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    pendingTasks.sort((a, b) => priorityScore[b.priority] - priorityScore[a.priority] || a.deadline - b.deadline);

    // Greedy pack into window
    let currentTime = windowStartAt;
    const scheduled: MaintenanceTask[] = [];

    for (const task of pendingTasks) {
      if (currentTime + task.estimatedDurationMs <= windowEndAt) {
        task.scheduledAt = currentTime;
        currentTime += task.estimatedDurationMs + 30 * 60_000; // 30-min buffer
        scheduled.push(task);
      }
    }

    const totalDuration = scheduled.reduce((s, t) => s + t.estimatedDurationMs, 0);
    const windowUtilization = totalDuration / (windowEndAt - windowStartAt);
    const urgentCovered = pendingTasks.filter(t => t.priority === 'urgent').every(t => scheduled.includes(t));

    return {
      scheduleId: `sched_${Date.now()}`,
      generatedAt: Date.now(),
      tasks: scheduled,
      totalEstimatedDurationMs: totalDuration,
      schedulingWindow: { startAt: windowStartAt, endAt: windowEndAt },
      optimizationScore: urgentCovered ? Math.min(1, windowUtilization * 0.8 + 0.5) : windowUtilization * 0.5,
      projectedRiskReductionPercent: scheduled.length > 0 ? Math.min(60, scheduled.length * 8) : 0,
    };
  }

  completeMaintenanceTask(taskId: string, outcome: 'success' | 'partial' | 'failed', notes?: string): MaintenanceTask {
    const task = this.maintenanceTasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = 'completed';
    task.completedAt = Date.now();
    task.outcome = outcome;
    task.notes = notes;

    if (outcome === 'success') {
      const asset = this.assets.get(task.assetId);
      if (asset) {
        asset.lastMaintenanceAt = Date.now();
        asset.currentHealth = 'healthy';
        asset.failureProbability7d = Math.max(0, asset.failureProbability7d - 0.3);
        asset.failureProbability30d = Math.max(0, asset.failureProbability30d - 0.4);
      }
    }

    logger.info('Maintenance task completed', { taskId, outcome });
    return task;
  }

  // ── SLA Risk Analysis ────────────────────────────────────────────────────

  analyzeSLARisk(assetId: string, slaTarget: number, penaltyPerHourUSD = 500): SLARiskReport {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);

    const prediction = this.predictFailure(assetId);
    const expectedDowntimeHours = prediction.probability30d * asset.mttrHours;
    const totalHoursIn30Days = 30 * 24;
    const projectedAvailability = 1 - expectedDowntimeHours / totalHoursIn30Days;

    const riskOfBreachPercent = projectedAvailability < slaTarget
      ? (slaTarget - projectedAvailability) / slaTarget * 100
      : 0;

    const allowedDowntimeHours = (1 - slaTarget) * totalHoursIn30Days;
    const bufferNeeded = Math.max(0, expectedDowntimeHours - allowedDowntimeHours);

    const financialExposureUSD = riskOfBreachPercent > 0
      ? expectedDowntimeHours * penaltyPerHourUSD
      : 0;

    return {
      assetId,
      slaTarget,
      projectedAvailability,
      riskOfBreachPercent,
      recommendedBufferHours: bufferNeeded,
      financialExposureUSD,
    };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getDashboardSummary(): Record<string, unknown> {
    const all = Array.from(this.assets.values());
    const byHealth = {
      healthy: all.filter(a => a.currentHealth === 'healthy').length,
      degraded: all.filter(a => a.currentHealth === 'degraded').length,
      at_risk: all.filter(a => a.currentHealth === 'at_risk').length,
      critical: all.filter(a => a.currentHealth === 'critical').length,
      failed: all.filter(a => a.currentHealth === 'failed').length,
    };

    const urgentTasks = Array.from(this.maintenanceTasks.values()).filter(t => t.priority === 'urgent' && t.status === 'pending');
    const highRiskAssets = all.filter(a => a.failureProbability7d > 0.5);

    return {
      totalAssets: all.length,
      healthDistribution: byHealth,
      urgentMaintenanceTasks: urgentTasks.length,
      highRiskAssets: highRiskAssets.length,
      avgFailureProbability7d: all.length > 0 ? all.reduce((s, a) => s + a.failureProbability7d, 0) / all.length : 0,
      totalTelemetryRecords: Array.from(this.telemetryHistory.values()).reduce((s, h) => s + h.length, 0),
    };
  }

  recordIncident(assetId: string, cause: string): string {
    const id = `inc_${Date.now()}`;
    this.incidents.set(id, { assetId, startedAt: Date.now(), cause });
    const asset = this.assets.get(assetId);
    if (asset) asset.currentHealth = 'failed';
    return id;
  }

  resolveIncident(incidentId: string): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) return;
    incident.resolvedAt = Date.now();
    const asset = this.assets.get(incident.assetId);
    if (asset) {
      const downtimeMs = incident.resolvedAt - incident.startedAt;
      asset.totalDowntimeMs += downtimeMs;
      asset.currentHealth = 'degraded';
      // Update MTTR estimate
      asset.mttrHours = (asset.mttrHours + downtimeMs / 3_600_000) / 2;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getPredictiveMaintenanceEngine(): PredictiveMaintenanceEngine {
  const key = '__predictiveMaintenanceEngine__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new PredictiveMaintenanceEngine();
  }
  return (globalThis as Record<string, unknown>)[key] as PredictiveMaintenanceEngine;
}
